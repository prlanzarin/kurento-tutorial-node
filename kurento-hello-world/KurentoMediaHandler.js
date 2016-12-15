/*
 * (C) Copyright 2016 Mconf Tecnologia (http://mconf.com/)
 */

var kmh = function() {};
/**
 * @classdesc
 * 	Custom sipjs's MediaHandler to manage media communication between
 * 	Kurento and Freeswitch
 * 	@constructor
 */
kmh.prototype.KurentoMediaHandler = function (session, options) {
  this.session = session;
  this.options = options;
  this.sdp = null;
  this.remote_sdp = null;
  this.version = '0.0.1';

  //Default video configuration
  this.video = {
      configuration: {
          codecId: '96',
          sendReceive: 'recvonly',
          rtpProfile: 'RTP/AVP',
          codecName: 'H264' ,
          codecRate: '90000',
          frameRate: '30.000000'
      }
  };
};

/**
 * Factory method for KurentoMediaHandler
 * @param  {Object} session Current session of this media handler
 * @param  {Object} options Options
 * @return {KurentoMediaHandler} A KurentoMediaHandler
 */
kmh.prototype.KurentoMediaHandler.defaultFactory = function kurentoDefaultFactory(session, options) {
  return new kmh.prototype.KurentoMediaHandler(session, options);
};

/**
 * Setup method for this media handler. This method MUST be called before
 * the SIP session starts.
 * @param  {Object} configuration Configuration parameters for the session
 */
kmh.prototype.KurentoMediaHandler.setup = function (configuration) {
    kmh.prototype.KurentoMediaHandler.prototype.local_ip_address = configuration.local_ip_address;
    kmh.prototype.KurentoMediaHandler.prototype.source_audio_ip_address = configuration.source_audio_ip_address;
    kmh.prototype.KurentoMediaHandler.prototype.source_audio_port = configuration.source_audio_port;
};

kmh.prototype.KurentoMediaHandler.prototype = {

  isReady: function () { return true; },

  close: function () {
    if (this.timeout) {
      clearTimeout(this.timeout);
      delete this.timeout;
    }
    delete this.session;
  },

  render: function(){},
  mute: function(){},
  unmute: function(){},

  getDescription: function (onSuccess, onFailure, mediaHint) {
    this.sdp = 'v=0\r\n'
    + 'o=- 0 0 IN IP4 ' + this.local_ip_address + '\r\n'
    + 's=Kurento\n'
    + 'm=audio ' + this.source_audio_port + ' RTP/AVP 98\r\n'
    + 'c=IN IP4 ' + this.source_audio_ip_address + '\r\n'
    + 'a=recvonly\r\n'
    + 'a=rtpmap:98 OPUS/48000/2\r\n'
    + 'a=fmtp:109 minptime=10; useinbandfec=1; stereo=1; sprop-stereo=1 ; cbr=1\r\n\r\n';
    //+ 'm=video ' + this.source_video_port + ' RTP/AVP 96\r\n'
    //+ 'a=sendonly\r\n'
    //+ 'a=rtpmap:96 H264/90000\r\n'
    //Intelbras IP Camera
    //+ 'a=framerate:30.000000\r\n'
    //+ 'a=fmtp:96 packetization-mode=1;profile-level-id=64001F;\r\n';
    this.timeout = setTimeout(function () {
      delete this.timeout;
      onSuccess(this.sdp);
  }.bind(this), 0);
  },

  setDescription: function (description, onSuccess, onFailure) {
    //console.log("Remote SDP:");
    //console.log(description);
    this.remote_sdp = description;
    this.timeout = setTimeout(function () {
      delete this.timeout;
      onSuccess();
    }.bind(this), 0);
  }
};

module.exports = new kmh();
