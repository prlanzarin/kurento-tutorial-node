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
 * See the License for the specific language governing permissions and * limitations under the License.  *
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
var https = require('https');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://fs-dev.mconf.com:8888/kurento'
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

var sessionHandler = session({
    secret : 'none',
    rolling : true,
    resave : true,
    saveUninitialized : true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */
var sessions = {};
var candidatesQueue = {};
var kurentoClient = null;
var webRtcEndpoints = {};
var rtpEndpoints = {};
var runningMediaSources = {};
var mediaPipeline = {};
var kurentoToken = null;

/*
 * FIXME hardcoded *
 */
var kurentoId = 5;
// var conferenceNumber = 70000;
var userId = 1;


/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
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
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
        writeHead : {}
    };

    sessionHandler(request, response, function(err) {
        sessionId = request.session.id;
        console.log('Connection received with sessionId ' + sessionId);
    });

    ws.on('error', function(error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function() {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
        case 'start':
            sessionId = request.session.id;
            start(sessionId, ws, message.sdpOffer, message.conferenceNumber, function(error, sdpAnswer) {
                if (error) {
                    return ws.send(JSON.stringify({
                        id : 'error',
                        message : error
                    }));
                }
                ws.send(JSON.stringify({
                    id : 'startResponse',
                    sdpAnswer : sdpAnswer
                }));
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

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function(error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                    + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function start(sessionId, ws, sdpOffer, conferenceNumber, callback) {
    if (!sessionId) {
        return callback('Cannot use undefined sessionId');
    }

    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }

        /* FIXME won't create one pipeline per sessionId */
        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if (error) {
                return callback(error);
            }

            createMediaElements(conferenceNumber, kurentoId, sessionId,  pipeline, ws, function(error, webRtcEndpoint) {
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

                connectMediaElements(webRtcEndpoint, function(error) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
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

                        sessions[sessionId] = {
                            'pipeline' : pipeline,
                            'webRtcEndpoint' : webRtcEndpoint
                        }
                        return callback(null, sdpAnswer);
                    });

                    webRtcEndpoint.gatherCandidates(function(error) {
                        if (error) {
                            return callback(error);
                        }
                    });
                });
            });
        });
    });
}

function createMediaElements(meetingId, mediaId, mediaUri, pipeline, ws, callback) {
    console.log("  [media] New player endpoint for " + mediaId + " (" + mediaUri + ")");

    if (rtpEndpoints[meetingId] && rtpEndpoints[meetingId][mediaId]){
        console.log("  [rtp] There's already an rtpEndpoint for this media. Won't create a new one");
        return;
    }

    if (webRtcEndpoints[mediaId]){
        console.log("  [media] WebRTC endpoint already exists");
        console.log("  [rtp] Creating new rtp endpoint");
        pipeline.create('RtpEndpoint', function(error, rtpEndpoint){
            if (error) {
                return callback(error);
            }

            if (!rtpEndpoints[meetingId]) {
                rtpEndpoints[meetingId] = {};
            }

            rtpEndpoint.meetingId = meetingId;
            rtpEndpoints[meetingId][mediaId] = rtpEndpoint;
            webRtcEndpoints[mediaId].listeners++;
            return callback(null, webRtcEndpoints[mediaId], rtpEndpoint);
        });
    }
    else {
        pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
            if (error) {
                return callback(error);
            }
            webRtcEndpoints.listeners = 0;
            webRtcEndpoints[mediaId] = webRtcEndpoint;
            pipeline.create('RtpEndpoint', function(error, rtpEndpoint){
                if (error) {
                    return callback(error);
                }

                if (!rtpEndpoints[meetingId]) {
                    rtpEndpoints[meetingId] = {};
                }

                rtpEndpoint.meetingId = meetingId;
                rtpEndpoints[meetingId][mediaId] = rtpEndpoint;
                webRtcEndpoints[mediaId].listeners++;
                return callback(null, webRtcEndpoint, rtpEndpoint);
            });
        });
    }
}

function connectMediaElements(webRtcEndpoint, rtpEndpoint, callback) {
    webRtcEndpoint.connect(rtpEndpoint, function(error) {
        if (error) {
            return callback(error);
        }
        console.log("  [rtp] Connected new WebRTC endpoint to a RTPEndpoint");
        return callback(null);
    });
}
  function getMediaPipeline(videoId, callback) {
      console.log("  [sip] Getting media pipeline for " + videoId);
      if (kurentoClient === null) {
        console.log('  [sip] Error: kurento Client is null.');
        return callback(true);
      }

      if (mediaPipeline &&
        mediaPipeline.hasOwnProperty(videoId)) {
        console.log(" [sip] Pipeline already created.");
        return callback(null, mediaPipeline[videoId]);
      }

      kurentoClient.create('MediaPipeline', function(error, pipeline) {
        console.log(" [sip] Creating new pipeline.");
        if (error) {
            return callback(error);
        }
        mediaPipeline[videoId] = pipeline;
        callback(null, pipeline);
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
        console.info('Sending candidate');
        var webRtcEndpoint = sessions[sessionId].webRtcEndpoint;
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

app.use(express.static(path.join(__dirname, 'static')));
