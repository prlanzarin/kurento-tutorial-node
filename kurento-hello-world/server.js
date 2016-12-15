/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var path = require('path');
var url = require('url');
var cookieParser = require('cookie-parser')
var express = require('express');
var session = require('express-session')
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs    = require('fs');
var http = require('http');
var sipjs = require('sip.js');
var kmh = require('./KurentoMediaHandler');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'http://192.168.2.111:8888/',
        ws_uri: 'ws://fs-dev.mconf.com:8888/kurento',
        fs_uri: '192.168.2.105:5066'
    }
});

var options =
{
  key:  fs.readFileSync('keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
 * Management of sessions
 */
app.use(cookieParser());

/*
 * Definition of global variables.
 */
var sessions = {};
var candidatesQueue = {};
var kurentoClient = null;

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = http.createServer(app).listen(port, function() {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server : server,
    path : '/helloworld'
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {
    console.log('Connection opened');
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
        writeHead : {}
    };

    ws.on('error', function(error) {
        console.log('Connection error');
        stop(sessionId);
    });

    ws.on('close', function() {
        console.log('Connection closed');
        stop(sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        // console.log('Connection received message\n', message);

        switch (message.id) {
        case 'start':
            sessionId = message.conference;
            start(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
                if (error) {
                    return ws.send(JSON.stringify({
                        id : 'error',
                        message : error
                    }));
                }
            });
            break;

        case 'stop':
            stop(sessionId);
            break;

        case 'onIceCandidate':
            onIceCandidate(sessionId, message.candidate);
            break;

        default:
            ws.send(JSON.stringify({
                id : 'error',
                message : 'Invalid message ' + message
            }));
            break;
        }

    });
});

/*
 * Definition of functions
 */

function start(sessionId, ws, sdpOffer, callback) {
  getKurentoClient(function(error, kurentoClient) {
    if (error) {
      return callback(error);
    }

    getMediaPipeline(kurentoClient, sessionId, function(error, pipeline) {
      if (error) {
        return callback(error);
      }

      pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
        if (error) {
          pipeline.release();
          return callback(error);
        }

        if (candidatesQueue[sessionId]) {
          while(candidatesQueue[sessionId].length) {
            var candidate = candidatesQueue[sessionId].shift();
            webRtcEndpoint.addIceCandidate(candidate);
          }
        }

        webRtcEndpoint.on('OnIceCandidate', function(event) {
          var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
          ws.send(JSON.stringify({
            id : 'iceCandidate',
            candidate : candidate
          }));
        });

        webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
          if (error) {
            pipeline.release();
            return callback(error);
          }

          ws.send(JSON.stringify({
            id: 'startResponse',
            sdpAnswer: sdpAnswer
          }));

          getConferenceAudioEndpoint(pipeline, sessionId, function(error, rtpEndpoint) {
            if (error) {
              pipeline.release();
              return callback(error);
            }

            rtpEndpoint.connect(webRtcEndpoint, function(error) {
              createUserAgent(sessionId, argv.fs_uri, function(error, ua) {
                var sip_configuration = {
                  local_ip_address: "192.168.2.111",
                  source_audio_ip_address: "169.57.148.140",
                  source_audio_port: 7000,
                };

                kmh.KurentoMediaHandler.setup(sip_configuration);

                var options = {
                  media: {
                    constraints: {
                        audio: true,
                        video: false
                    }
                  },
                  params: {
                    from_displayName : sessionId
                  }
                };

                session = ua.invite('sip:' + sessionId + '@' + argv.fs_uri);

                session.on('accepted', function(data) {
                  var rtpSdpOffer = session.mediaHandler.remote_sdp;
                  console.log(rtpSdpOffer);
                  rtpEndpoint.processOffer(rtpSdpOffer, function(error, rtpSdpAnswer) {
                    sessions[sessionId] = {
                      'pipeline': pipeline,
                      'webRtcEndpoint': webRtcEndpoint,
                      'rtpEndpoint': rtpEndpoint
                    };
                  });
                });
              });
            })
          });
        });

        webRtcEndpoint.gatherCandidates(function(error) {
          if (error) {
            return callback(error);
          }
        });
      });
    });
  });
}

function stop(sessionId) {
    if (sessions[sessionId]) {
        var pipeline = sessions[sessionId].pipeline;
        console.info('Releasing pipeline');
        pipeline.release();

        delete sessions[sessionId];
        delete candidatesQueue[sessionId];
    }
}

function onIceCandidate(sessionId, _candidate) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (sessions[sessionId]) {
        var webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

function createUserAgent(sessionId, server, callback) {
  console.log("Creating new user agent");

  var configuration = {
    uri: 'sip:' + encodeURIComponent(sessionId) + '@' + server,
    wsServers: 'ws://' + server + '/ws',
    displayName: sessionId,
    register: false,
    traceSip: true,
    autostart: false,
    userAgentString: "BigBlueButton",
    mediaHandlerFactory: kmh.KurentoMediaHandler.defaultFactory
  };
  
  var ua = new sipjs.UA(configuration);
  ua.start();

  if (ua) {
    return callback(null, ua);
  } else {
    return callback(true);
  }
}

function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }

  kurento(argv.ws_uri, function(error, _kurentoClient) {
    if (error) {
      console.log("Could not find media server at address " + argv.ws_uri);
      return callback("Exiting with error " + error);
    }

    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}

function getMediaPipeline(kurentoClient, sessionId, callback) {
  if (sessions[sessionId] != null) {
    return callback(null, sessions[sessionId].pipeline);
  }

  kurentoClient.create('MediaPipeline', function(error, pipeline) {
    if (error) {
      return callback(error);
    }

    return callback(null, pipeline);
  })
}

function getConferenceAudioEndpoint(pipeline, sessionId, callback) {
  if (sessions[sessionId] != null) {
    return callback(null, sessions[sessionId].rtpEndpoint);
  }

  pipeline.create('RtpEndpoint', function(error, rtpEndpoint) {
    if (error) {
      return callback(error);
    }

    return callback(null, rtpEndpoint);
  });
}

app.use(express.static(path.join(__dirname, 'static')));
