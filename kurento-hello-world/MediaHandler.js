var lomh = function() {};
/**
 * @classdesc
 *  Custom sipjs's MediaHandler to manage media communication between
 *  Kurento and Freeswitch
 *  @constructor
 */
lomh.prototype.ListenOnlyMediaHandler = function (session, options) {
  this.session = session;
  this.options = options;
  this.sdp = null;
  this.remote_sdp = null;

  return this;
};

/**
 * Factory method for ListenOnlyMediaHandler
 * @param  {Object} session Current session of this media handler
 * @param  {Object} options Options
 * @return {ListenOnlyMediaHandler} A ListenOnlyMediaHandler
 */
lomh.prototype.ListenOnlyMediaHandler.defaultFactory = function (session, options) {
  return new lomh.prototype.ListenOnlyMediaHandler(session, options);
};

/**
 * Setup method for this media handler. This method MUST be called before
 * the SIP session starts.
 * @param  {Object} configuration Configuration parameters for the session
 */
lomh.prototype.ListenOnlyMediaHandler.setup = function (configuration) {
    ListenOnlyMediaHandler.prototype.local_ip_address = configuration.local_ip_address;
    ListenOnlyMediaHandler.prototype.source_audio_ip_address = configuration.source_audio_ip_address;
    ListenOnlyMediaHandler.prototype.source_audio_port = configuration.source_audio_port;
};

lomh.prototype.ListenOnlyMediaHandler.prototype = {

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
    + 'a=sendonly\r\n'
    + 'a=rtpmap:98 OPUS/48000/2\r\n'
    + 'a=fmtp:109 minptime=10; useinbandfec=1; stereo=1; sprop-stereo=1 ; cbr=1\r\n\r\n';
    this.timeout = setTimeout(function () {
      delete this.timeout;
      onSuccess(this.sdp);
  }.bind(this), 0);
  },

  setDescription: function (description, onSuccess, onFailure) {
    this.remote_sdp = description;
    this.timeout = setTimeout(function () {
      delete this.timeout;
      onSuccess();
    }.bind(this), 0);
  }
};

module.exports = new lomh();
