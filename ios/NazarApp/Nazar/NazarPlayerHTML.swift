import Foundation

// Auto-generated from ../nazar_player.html — the self-contained go2rtc live player.
// Embedded as a compiled string (NOT a bundle resource): a loose resource carries an
// un-strippable com.apple.provenance xattr that deadlocks codesign --strip-disallowed-xattrs
// during App Store export. To edit: change ../nazar_player.html and regenerate this file.
let nazarPlayerHTML = ##"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Nazar Live</title>
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; height:100%; background:#000; overflow:hidden; -webkit-user-select:none; user-select:none; }
  #rail { position:fixed; inset:0; display:flex; overflow-x:auto; overflow-y:hidden;
          scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  #rail::-webkit-scrollbar { display:none; }
  .slide { position:relative; flex:0 0 100%; width:100%; height:100%; scroll-snap-align:center;
           scroll-snap-stop:always; background:#000; overflow:hidden; }
  /* poster (snapshot) sits under live; live fades in over it -> never a black gap */
  .poster { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#000; z-index:0; }
  .slide nazar-rtc { position:absolute; inset:0; width:100%; height:100%; z-index:1; opacity:0;
                     transition:opacity .15s linear; pointer-events:none; }
  .slide nazar-rtc video { width:100%; height:100%; object-fit:contain; background:#000; }
  .slide.live nazar-rtc { opacity:1; }
  .bar { position:absolute; top:0; left:0; right:0; z-index:5; display:flex; justify-content:space-between;
         align-items:flex-start; padding:calc(env(safe-area-inset-top) + 10px) 16px 12px;
         background:linear-gradient(rgba(0,0,0,.65),transparent); pointer-events:none; }
  .name { color:#fff; font:800 16px -apple-system,system-ui,sans-serif; text-shadow:0 1px 4px #000; }
  .idx  { color:#aab4c2; font:700 12px -apple-system,system-ui,sans-serif; margin-left:8px; }
  .x { color:#fff; font-size:30px; line-height:1; padding:0 4px; pointer-events:auto; }
  .note { position:absolute; left:14px; top:calc(env(safe-area-inset-top) + 52px); z-index:5;
          max-width:calc(100% - 28px); padding:6px 10px; border-radius:999px; background:rgba(146,64,14,.88);
          color:#ffedd5; font:900 12px -apple-system,system-ui,sans-serif; display:none; }
  .slide.backup .note { display:block; }
  .status { position:absolute; left:14px; bottom:calc(env(safe-area-inset-bottom) + 70px); z-index:4;
            padding:6px 10px; border-radius:999px; background:rgba(2,6,23,.78); color:#e5e7eb;
            font:800 12px -apple-system,system-ui,sans-serif; display:none; }
  .slide.wait .status, .slide.bad .status { display:block; }
  .slide.live .status { display:none; }
  .slide.bad .status { background:rgba(127,29,29,.82); color:#fecaca; }
  .dots { position:absolute; bottom:calc(env(safe-area-inset-bottom) + 60px); left:0; right:0; z-index:5;
          display:flex; gap:5px; justify-content:center; flex-wrap:wrap; padding:0 22px; pointer-events:none; }
  .dot { width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.35); transition:width .2s; }
  .dot.on { background:#fff; width:16px; border-radius:3px; }
  .rw { position:absolute; bottom:0; left:0; right:0; z-index:5; display:flex; gap:7px; align-items:center;
        overflow-x:auto; padding:12px 14px calc(env(safe-area-inset-bottom) + 14px);
        background:linear-gradient(transparent,rgba(0,0,0,.8)); }
  .rw::-webkit-scrollbar { display:none; }
  .rwb { flex:none; padding:8px 13px; border-radius:999px; border:1px solid rgba(255,255,255,.25);
         background:rgba(0,0,0,.35); color:#fff; font:800 12px -apple-system,system-ui,sans-serif; white-space:nowrap; }
  .rwb.live { border-color:#7FDC8A; color:#7FDC8A; }
  .rwb.on { background:#C8642D; color:#1a1405; border-color:#C8642D; }
  .rwtag { flex:none; color:#C8642D; font:800 12px -apple-system,system-ui,sans-serif; white-space:nowrap; margin-left:4px; }
</style>
</head>
<body>
<div id="rail"></div>
<div class="bar"><span><span class="name" id="name"></span><span class="idx" id="idx"></span></span><span class="x" id="close">✕</span></div>
<div class="dots" id="dots"></div>
<div class="rw" id="rw">
  <span class="rwb live on" data-m="0">● LIVE</span>
  <span class="rwb" data-m="15">15 min</span><span class="rwb" data-m="60">1 hr</span>
  <span class="rwb" data-m="180">3 hr</span><span class="rwb" data-m="1440">Yesterday</span>
  <span class="rwtag" id="rwtag"></span>
</div>

<script>
/**
 * VideoRTC v1.6.0 - Video player for go2rtc streaming application.
 *
 * All modern web technologies are supported in almost any browser except Apple Safari.
 *
 * Support:
 * - ECMAScript 2017 (ES8) = ES6 + async
 * - RTCPeerConnection for Safari iOS 11.0+
 * - IntersectionObserver for Safari iOS 12.2+
 * - ManagedMediaSource for Safari 17+
 *
 * Doesn't support:
 * - MediaSource for Safari iOS
 * - Customized built-in elements (extends HTMLVideoElement) because Safari
 * - Autoplay for WebRTC in Safari
 */
class VideoRTC extends HTMLElement {
    constructor() {
        super();

        this.DISCONNECT_TIMEOUT = 5000;
        this.RECONNECT_TIMEOUT = 15000;

        this.CODECS = [
            'avc1.640029',      // H.264 high 4.1 (Chromecast 1st and 2nd Gen)
            'avc1.64002A',      // H.264 high 4.2 (Chromecast 3rd Gen)
            'avc1.640033',      // H.264 high 5.1 (Chromecast with Google TV)
            'hvc1.1.6.L153.B0', // H.265 main 5.1 (Chromecast Ultra)
            'mp4a.40.2',        // AAC LC
            'mp4a.40.5',        // AAC HE
            'flac',             // FLAC (PCM compatible)
            'opus',             // OPUS Chrome, Firefox
        ];

        /**
         * [config] Supported modes (webrtc, webrtc/tcp, mse, hls, mp4, mjpeg).
         * @type {string}
         */
        this.mode = 'webrtc,mse,hls,mjpeg';

        /**
         * [Config] Requested medias (video, audio, microphone).
         * @type {string}
         */
        this.media = 'video,audio';

        /**
         * [config] Run stream when not displayed on the screen. Default `false`.
         * @type {boolean}
         */
        this.background = false;

        /**
         * [config] Run stream only when player in the viewport. Stop when user scroll out player.
         * Value is percentage of visibility from `0` (not visible) to `1` (full visible).
         * Default `0` - disable;
         * @type {number}
         */
        this.visibilityThreshold = 0;

        /**
         * [config] Run stream only when browser page on the screen. Stop when user change browser
         * tab or minimise browser windows.
         * @type {boolean}
         */
        this.visibilityCheck = true;

        /**
         * [config] WebRTC configuration
         * @type {RTCConfiguration}
         */
        this.pcConfig = {
            bundlePolicy: 'max-bundle',
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
            sdpSemantics: 'unified-plan',  // important for Chromecast 1
        };

        /**
         * [info] WebSocket connection state. Values: CONNECTING, OPEN, CLOSED
         * @type {number}
         */
        this.wsState = WebSocket.CLOSED;

        /**
         * [info] WebRTC connection state.
         * @type {number}
         */
        this.pcState = WebSocket.CLOSED;

        /**
         * @type {HTMLVideoElement}
         */
        this.video = null;

        /**
         * @type {WebSocket}
         */
        this.ws = null;

        /**
         * @type {string|URL}
         */
        this.wsURL = '';

        /**
         * @type {RTCPeerConnection}
         */
        this.pc = null;

        /**
         * @type {number}
         */
        this.connectTS = 0;

        /**
         * @type {string}
         */
        this.mseCodecs = '';

        /**
         * [internal] Disconnect TimeoutID.
         * @type {number}
         */
        this.disconnectTID = 0;

        /**
         * [internal] Reconnect TimeoutID.
         * @type {number}
         */
        this.reconnectTID = 0;

        /**
         * [internal] Handler for receiving Binary from WebSocket.
         * @type {Function}
         */
        this.ondata = null;

        /**
         * [internal] Handlers list for receiving JSON from WebSocket.
         * @type {Object.<string,Function>}
         */
        this.onmessage = null;
    }

    /**
     * Set video source (WebSocket URL). Support relative path.
     * @param {string|URL} value
     */
    set src(value) {
        if (typeof value !== 'string') value = value.toString();
        if (value.startsWith('http')) {
            value = 'ws' + value.substring(4);
        } else if (value.startsWith('/')) {
            value = 'ws' + location.origin.substring(4) + value;
        }

        this.wsURL = value;

        this.onconnect();
    }

    /**
     * Play video. Support automute when autoplay blocked.
     * https://developer.chrome.com/blog/autoplay/
     */
    play() {
        this.video.play().catch(() => {
            if (!this.video.muted) {
                this.video.muted = true;
                this.video.play().catch(er => {
                    console.warn(er);
                });
            }
        });
    }

    /**
     * Send message to server via WebSocket
     * @param {Object} value
     */
    send(value) {
        if (this.ws) this.ws.send(JSON.stringify(value));
    }

    /** @param {Function} isSupported */
    codecs(isSupported) {
        return this.CODECS
            .filter(codec => this.media.indexOf(codec.indexOf('vc1') > 0 ? 'video' : 'audio') >= 0)
            .filter(codec => isSupported(`video/mp4; codecs="${codec}"`)).join();
    }

    /**
     * `CustomElement`. Invoked each time the custom element is appended into a
     * document-connected element.
     */
    connectedCallback() {
        if (this.disconnectTID) {
            clearTimeout(this.disconnectTID);
            this.disconnectTID = 0;
        }

        // because video autopause on disconnected from DOM
        if (this.video) {
            const seek = this.video.seekable;
            if (seek.length > 0) {
                this.video.currentTime = seek.end(seek.length - 1);
            }
            this.play();
        } else {
            this.oninit();
        }

        this.onconnect();
    }

    /**
     * `CustomElement`. Invoked each time the custom element is disconnected from the
     * document's DOM.
     */
    disconnectedCallback() {
        if (this.background || this.disconnectTID) return;
        if (this.wsState === WebSocket.CLOSED && this.pcState === WebSocket.CLOSED) return;

        this.disconnectTID = setTimeout(() => {
            if (this.reconnectTID) {
                clearTimeout(this.reconnectTID);
                this.reconnectTID = 0;
            }

            this.disconnectTID = 0;

            this.ondisconnect();
        }, this.DISCONNECT_TIMEOUT);
    }

    /**
     * Creates child DOM elements. Called automatically once on `connectedCallback`.
     */
    oninit() {
        this.video = document.createElement('video');
        this.video.controls = true;
        this.video.playsInline = true;
        this.video.preload = 'auto';

        this.video.style.display = 'block'; // fix bottom margin 4px
        this.video.style.width = '100%';
        this.video.style.height = '100%';

        this.appendChild(this.video);

        this.video.addEventListener('error', ev => {
            console.warn(ev);
            if (this.ws) this.ws.close(); // run reconnect for broken MSE stream
        });

        // all Safari lies about supported audio codecs
        const m = window.navigator.userAgent.match(/Version\/(\d+).+Safari/);
        if (m) {
            // AAC from v13, FLAC from v14, OPUS - unsupported
            const skip = m[1] < '13' ? 'mp4a.40.2' : m[1] < '14' ? 'flac' : 'opus';
            this.CODECS.splice(this.CODECS.indexOf(skip));
        }

        if (this.background) return;

        if ('hidden' in document && this.visibilityCheck) {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.disconnectedCallback();
                } else if (this.isConnected) {
                    this.connectedCallback();
                }
            });
        }

        if ('IntersectionObserver' in window && this.visibilityThreshold) {
            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) {
                        this.disconnectedCallback();
                    } else if (this.isConnected) {
                        this.connectedCallback();
                    }
                });
            }, {threshold: this.visibilityThreshold});
            observer.observe(this);
        }
    }

    /**
     * Connect to WebSocket. Called automatically on `connectedCallback`.
     * @return {boolean} true if the connection has started.
     */
    onconnect() {
        if (!this.isConnected || !this.wsURL || this.ws || this.pc) return false;

        // CLOSED or CONNECTING => CONNECTING
        this.wsState = WebSocket.CONNECTING;

        this.connectTS = Date.now();

        this.ws = new WebSocket(this.wsURL);
        this.ws.binaryType = 'arraybuffer';
        this.ws.addEventListener('open', () => this.onopen());
        this.ws.addEventListener('close', () => this.onclose());

        return true;
    }

    ondisconnect() {
        this.wsState = WebSocket.CLOSED;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.pcState = WebSocket.CLOSED;
        if (this.pc) {
            this.pc.getSenders().forEach(sender => {
                if (sender.track) sender.track.stop();
            });
            this.pc.close();
            this.pc = null;
        }

        this.video.src = '';
        this.video.srcObject = null;
    }

    /**
     * @returns {Array.<string>} of modes (mse, webrtc, etc.)
     */
    onopen() {
        // CONNECTING => OPEN
        this.wsState = WebSocket.OPEN;

        this.ws.addEventListener('message', ev => {
            if (typeof ev.data === 'string') {
                const msg = JSON.parse(ev.data);
                for (const mode in this.onmessage) {
                    this.onmessage[mode](msg);
                }
            } else {
                this.ondata(ev.data);
            }
        });

        this.ondata = null;
        this.onmessage = {};

        const modes = [];

        if (this.mode.indexOf('mse') >= 0 && ('MediaSource' in window || 'ManagedMediaSource' in window)) {
            modes.push('mse');
            this.onmse();
        } else if (this.mode.indexOf('hls') >= 0 && this.video.canPlayType('application/vnd.apple.mpegurl')) {
            modes.push('hls');
            this.onhls();
        } else if (this.mode.indexOf('mp4') >= 0) {
            modes.push('mp4');
            this.onmp4();
        }

        if (this.mode.indexOf('webrtc') >= 0 && 'RTCPeerConnection' in window) {
            modes.push('webrtc');
            this.onwebrtc();
        }

        if (this.mode.indexOf('mjpeg') >= 0) {
            if (modes.length) {
                this.onmessage['mjpeg'] = msg => {
                    if (msg.type !== 'error' || msg.value.indexOf(modes[0]) !== 0) return;
                    this.onmjpeg();
                };
            } else {
                modes.push('mjpeg');
                this.onmjpeg();
            }
        }

        return modes;
    }

    /**
     * @return {boolean} true if reconnection has started.
     */
    onclose() {
        if (this.wsState === WebSocket.CLOSED) return false;

        // CONNECTING, OPEN => CONNECTING
        this.wsState = WebSocket.CONNECTING;
        this.ws = null;

        // reconnect no more than once every X seconds
        const delay = Math.max(this.RECONNECT_TIMEOUT - (Date.now() - this.connectTS), 0);

        this.reconnectTID = setTimeout(() => {
            this.reconnectTID = 0;
            this.onconnect();
        }, delay);

        return true;
    }

    onmse() {
        /** @type {MediaSource} */
        let ms;

        if ('ManagedMediaSource' in window) {
            const MediaSource = window.ManagedMediaSource;

            ms = new MediaSource();
            ms.addEventListener('sourceopen', () => {
                this.send({type: 'mse', value: this.codecs(MediaSource.isTypeSupported)});
            }, {once: true});

            this.video.disableRemotePlayback = true;
            this.video.srcObject = ms;
        } else {
            ms = new MediaSource();
            ms.addEventListener('sourceopen', () => {
                URL.revokeObjectURL(this.video.src);
                this.send({type: 'mse', value: this.codecs(MediaSource.isTypeSupported)});
            }, {once: true});

            this.video.src = URL.createObjectURL(ms);
            this.video.srcObject = null;
        }

        this.play();

        this.mseCodecs = '';

        this.onmessage['mse'] = msg => {
            if (msg.type !== 'mse') return;

            this.mseCodecs = msg.value;

            const sb = ms.addSourceBuffer(msg.value);
            sb.mode = 'segments'; // segments or sequence
            sb.addEventListener('updateend', () => {
                if (!sb.updating && bufLen > 0) {
                    try {
                        const data = buf.slice(0, bufLen);
                        sb.appendBuffer(data);
                        bufLen = 0;
                    } catch (e) {
                        // console.debug(e);
                    }
                }

                if (!sb.updating && sb.buffered && sb.buffered.length) {
                    const end = sb.buffered.end(sb.buffered.length - 1);
                    const start = end - 5;
                    const start0 = sb.buffered.start(0);
                    if (start > start0) {
                        sb.remove(start0, start);
                        ms.setLiveSeekableRange(start, end);
                    }
                    if (this.video.currentTime < start) {
                        this.video.currentTime = start;
                    }
                    const gap = end - this.video.currentTime;
                    this.video.playbackRate = gap > 0.1 ? gap : 0.1;
                    // console.debug('VideoRTC.buffered', gap, this.video.playbackRate, this.video.readyState);
                }
            });

            const buf = new Uint8Array(2 * 1024 * 1024);
            let bufLen = 0;

            this.ondata = data => {
                if (sb.updating || bufLen > 0) {
                    const b = new Uint8Array(data);
                    buf.set(b, bufLen);
                    bufLen += b.byteLength;
                    // console.debug('VideoRTC.buffer', b.byteLength, bufLen);
                } else {
                    try {
                        sb.appendBuffer(data);
                    } catch (e) {
                        // console.debug(e);
                    }
                }
            };
        };
    }

    onwebrtc() {
        const pc = new RTCPeerConnection(this.pcConfig);

        pc.addEventListener('icecandidate', ev => {
            if (ev.candidate && this.mode.indexOf('webrtc/tcp') >= 0 && ev.candidate.protocol === 'udp') return;

            const candidate = ev.candidate ? ev.candidate.toJSON().candidate : '';
            this.send({type: 'webrtc/candidate', value: candidate});
        });

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'connected') {
                const tracks = pc.getTransceivers()
                    .filter(tr => tr.currentDirection === 'recvonly') // skip inactive
                    .map(tr => tr.receiver.track);
                /** @type {HTMLVideoElement} */
                const video2 = document.createElement('video');
                video2.addEventListener('loadeddata', () => this.onpcvideo(video2), {once: true});
                video2.srcObject = new MediaStream(tracks);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                pc.close(); // stop next events

                this.pcState = WebSocket.CLOSED;
                this.pc = null;

                this.onconnect();
            }
        });

        this.onmessage['webrtc'] = msg => {
            switch (msg.type) {
                case 'webrtc/candidate':
                    if (this.mode.indexOf('webrtc/tcp') >= 0 && msg.value.indexOf(' udp ') > 0) return;

                    pc.addIceCandidate({candidate: msg.value, sdpMid: '0'}).catch(er => {
                        console.warn(er);
                    });
                    break;
                case 'webrtc/answer':
                    pc.setRemoteDescription({type: 'answer', sdp: msg.value}).catch(er => {
                        console.warn(er);
                    });
                    break;
                case 'error':
                    if (msg.value.indexOf('webrtc/offer') < 0) return;
                    pc.close();
            }
        };

        this.createOffer(pc).then(offer => {
            this.send({type: 'webrtc/offer', value: offer.sdp});
        });

        this.pcState = WebSocket.CONNECTING;
        this.pc = pc;
    }

    /**
     * @param pc {RTCPeerConnection}
     * @return {Promise<RTCSessionDescriptionInit>}
     */
    async createOffer(pc) {
        try {
            if (this.media.indexOf('microphone') >= 0) {
                const media = await navigator.mediaDevices.getUserMedia({audio: true});
                media.getTracks().forEach(track => {
                    pc.addTransceiver(track, {direction: 'sendonly'});
                });
            }
        } catch (e) {
            console.warn(e);
        }

        for (const kind of ['video', 'audio']) {
            if (this.media.indexOf(kind) >= 0) {
                pc.addTransceiver(kind, {direction: 'recvonly'});
            }
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return offer;
    }

    /**
     * @param video2 {HTMLVideoElement}
     */
    onpcvideo(video2) {
        if (this.pc) {
            // Video+Audio > Video, H265 > H264, Video > Audio, WebRTC > MSE
            let rtcPriority = 0, msePriority = 0;

            /** @type {MediaStream} */
            const stream = video2.srcObject;
            if (stream.getVideoTracks().length > 0) rtcPriority += 0x220;
            if (stream.getAudioTracks().length > 0) rtcPriority += 0x102;

            if (this.mseCodecs.indexOf('hvc1.') >= 0) msePriority += 0x230;
            if (this.mseCodecs.indexOf('avc1.') >= 0) msePriority += 0x210;
            if (this.mseCodecs.indexOf('mp4a.') >= 0) msePriority += 0x101;

            if (rtcPriority >= msePriority) {
                this.video.srcObject = stream;
                this.play();

                this.pcState = WebSocket.OPEN;

                this.wsState = WebSocket.CLOSED;
                if (this.ws) {
                    this.ws.close();
                    this.ws = null;
                }
            } else {
                this.pcState = WebSocket.CLOSED;
                if (this.pc) {
                    this.pc.close();
                    this.pc = null;
                }
            }
        }

        video2.srcObject = null;
    }

    onmjpeg() {
        this.ondata = data => {
            this.video.controls = false;
            this.video.poster = 'data:image/jpeg;base64,' + VideoRTC.btoa(data);
        };

        this.send({type: 'mjpeg'});
    }

    onhls() {
        this.onmessage['hls'] = msg => {
            if (msg.type !== 'hls') return;

            const url = 'http' + this.wsURL.substring(2, this.wsURL.indexOf('/ws')) + '/hls/';
            const playlist = msg.value.replace('hls/', url);
            this.video.src = 'data:application/vnd.apple.mpegurl;base64,' + btoa(playlist);
            this.play();
        };

        this.send({type: 'hls', value: this.codecs(type => this.video.canPlayType(type))});
    }

    onmp4() {
        /** @type {HTMLCanvasElement} **/
        const canvas = document.createElement('canvas');
        /** @type {CanvasRenderingContext2D} */
        let context;

        /** @type {HTMLVideoElement} */
        const video2 = document.createElement('video');
        video2.autoplay = true;
        video2.playsInline = true;
        video2.muted = true;

        video2.addEventListener('loadeddata', () => {
            if (!context) {
                canvas.width = video2.videoWidth;
                canvas.height = video2.videoHeight;
                context = canvas.getContext('2d');
            }

            context.drawImage(video2, 0, 0, canvas.width, canvas.height);

            this.video.controls = false;
            this.video.poster = canvas.toDataURL('image/jpeg');
        });

        this.ondata = data => {
            video2.src = 'data:video/mp4;base64,' + VideoRTC.btoa(data);
        };

        this.send({type: 'mp4', value: this.codecs(this.video.canPlayType)});
    }

    static btoa(buffer) {
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        let binary = '';
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

class NazarRTCElement extends VideoRTC {
  constructor() {
    super();
    this.mode = 'webrtc,mse,mp4,mjpeg';
    this.media = 'video';
    this.visibilityThreshold = 0;
    this.DISCONNECT_TIMEOUT = 0;
    this._firstFrame = false;
    this._transport = 'connecting';
  }

  oninit() {
    super.oninit();
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.height = '100%';
    this.style.background = '#000';
    this.video.controls = false;
    this.video.muted = true;
    this.video.defaultMuted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.setAttribute('muted', '');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    ['loadeddata', 'canplay', 'playing'].forEach(type => {
      this.video.addEventListener(type, () => this._emitFirstFrame(this._transport || 'live'), {once: false});
    });
  }

  onopen() {
    const modes = super.onopen();
    this.dispatchEvent(new CustomEvent('nazar-open', {detail: {modes}}));
    if (this.onmessage) {
      Object.keys(this.onmessage).forEach(mode => {
        const original = this.onmessage[mode];
        this.onmessage[mode] = msg => {
          if (msg && msg.type === 'error') {
            this.dispatchEvent(new CustomEvent('nazar-error', {detail: {mode, value: msg.value || ''}}));
          }
          return original(msg);
        };
      });
    }
    return modes;
  }

  onclose() {
    const reconnecting = super.onclose();
    if (reconnecting) this.dispatchEvent(new CustomEvent('nazar-reconnect'));
    return reconnecting;
  }

  onmse() {
    this._setTransport('mse');
    return super.onmse();
  }

  onmp4() {
    this._setTransport('mp4');
    return super.onmp4();
  }

  onmjpeg() {
    this._setTransport('mjpeg');
    return super.onmjpeg();
  }

  onpcvideo(video2) {
    this._setTransport('webrtc');
    const out = super.onpcvideo(video2);
    setTimeout(() => {
      if (this.video && this.video.readyState >= 2) this._emitFirstFrame('webrtc');
    }, 0);
    return out;
  }

  _setTransport(transport) {
    if (this._transport === transport) return;
    this._transport = transport;
    this.dispatchEvent(new CustomEvent('nazar-transport', {detail: {transport}}));
  }

  _emitFirstFrame(transport) {
    if (this._firstFrame) return;
    this._firstFrame = true;
    this._setTransport(transport);
    this.dispatchEvent(new CustomEvent('nazar-first-frame', {detail: {transport}}));
  }
}

if (!customElements.get('nazar-rtc')) customElements.define('nazar-rtc', NazarRTCElement);

window.NazarRTCPlayer = {
  create(opts) {
    opts = opts || {};
    const el = document.createElement('nazar-rtc');
    el.mode = opts.mode || 'webrtc,mse,mp4,mjpeg';
    el.media = opts.media || 'video';
    el.dataset.cam = opts.cam || '';
    if (opts.src) el.src = opts.src;
    return el;
  }
};

const C = window.__nazarConfig || {cams:[], startIndex:0};
function post(action, data){ try { window.webkit.messageHandlers.nazar.postMessage(Object.assign({action}, data||{})); } catch(e){} }
function snapURL(id){ return C.snap + '?cam=' + encodeURIComponent(id) + '&_=' + Date.now(); }
function liveSrc(liveId){ return C.liveWs + '?src=' + encodeURIComponent(liveId); }
function rewindSrc(){ return C.rewindWs + '?src=rw_live'; }

let cur = 0, mode = 'live', jumping = false;
const slides = [];

function setStatus(s, cls, msg){
  s.el.classList.remove('wait','bad','live');
  if(cls) s.el.classList.add(cls);
  if(msg && s.status) s.status.textContent = msg;
}

function unmount(s){
  if(s._warm){ clearTimeout(s._warm); s._warm=null; }
  if(s.rtc){ try{ s.rtc.ondisconnect && s.rtc.ondisconnect(); }catch(e){} try{ s.rtc.remove(); }catch(e){} s.rtc=null; }
  s.loaded=false; s.el.classList.remove('live','wait','bad');
}

function mount(s, opts){
  opts = opts || {};
  unmount(s);
  s.poster.src = snapURL(s.id);                 // fresh snapshot stays visible until live paints
  setStatus(s, 'wait', 'opening live…');
  s._warm = setTimeout(function(){ if(!s.loaded) setStatus(s,'bad','camera slow / latest frame shown'); }, 5000);
  const rtc = window.NazarRTCPlayer.create({
    cam: s.id,
    src: opts.rewind ? rewindSrc() : liveSrc(s.liveId),
    mode: opts.rewind ? 'mse,mp4' : 'webrtc,mse,mp4',   // live prefers WebRTC (sub-second); rewind is playback
    media: 'video'
  });
  s.rtc = rtc;
  rtc.addEventListener('nazar-first-frame', function(){
    if(s.rtc !== rtc) return;
    s.loaded = true; if(s._warm){ clearTimeout(s._warm); s._warm=null; }
    s.el.classList.add('live'); s.el.classList.remove('wait','bad');
  });
  rtc.addEventListener('nazar-error', function(){ /* poster stays; component retries internally */ });
  s.el.insertBefore(rtc, s.poster.nextSibling);
}

function build(){
  const rail = document.getElementById('rail'), dots = document.getElementById('dots');
  C.cams.forEach(function(c, i){
    const el = document.createElement('div'); el.className = 'slide';
    if(c.note) el.classList.add('backup');
    const poster = document.createElement('img'); poster.className = 'poster'; poster.decoding='async';
    poster.src = snapURL(c.id);
    const note = document.createElement('div'); note.className='note'; note.textContent = c.note || '';
    const status = document.createElement('div'); status.className='status'; status.textContent='opening live…';
    el.appendChild(poster); el.appendChild(note); el.appendChild(status);
    rail.appendChild(el);
    slides.push({ id:c.id, liveId:c.liveId||c.id, label:c.label, el:el, poster:poster, status:status, loaded:false });
    const d = document.createElement('span'); d.className = 'dot' + (i===0?' on':''); dots.appendChild(d);
  });
  const io = new IntersectionObserver(function(ents){
    if(jumping) return;
    ents.forEach(function(en){
      if(en.isIntersecting && en.intersectionRatio >= 0.6){
        for(let i=0;i<slides.length;i++){ if(slides[i].el===en.target){ if(i!==cur) setCurrent(i); break; } }
      }
    });
  }, { root: rail, threshold:[0.6] });
  slides.forEach(function(s){ io.observe(s.el); });
}

function setCurrent(i){
  const s = slides[i]; if(!s) return;   // defensive: never crash on a missing/empty config
  cur = i; mode = 'live';
  document.getElementById('name').textContent = s.label;
  document.getElementById('idx').textContent = (i+1) + '/' + slides.length;
  document.getElementById('rwtag').textContent = ''; markRw(0);
  fetch(C.rewindStopApi, {method:'POST'}).catch(function(){});   // leaving a camera ends any rewind on it
  const dots = document.getElementById('dots').children;
  for(let k=0;k<dots.length;k++) dots[k].classList.toggle('on', k===i);
  // only the current camera streams live (light on the box); neighbours stay on poster
  slides.forEach(function(sl, j){ if(j===i) mount(sl); else unmount(sl); });
}

function markRw(m){
  Array.prototype.forEach.call(document.querySelectorAll('.rwb'), function(b){
    b.classList.toggle('on', b.getAttribute('data-m')===String(m));
  });
}

function openAt(idx){
  const rail = document.getElementById('rail');
  jumping = true;
  void rail.offsetWidth;
  rail.scrollLeft = idx * rail.clientWidth; setCurrent(idx);
  requestAnimationFrame(function(){
    rail.scrollLeft = idx * rail.clientWidth; setCurrent(idx);
    setTimeout(function(){ jumping = false; }, 350);
  });
}

async function rewind(mins){
  const s = slides[cur];
  document.getElementById('rwtag').textContent = 'loading…'; markRw(mins);
  try {
    const r = await (await fetch(C.rewindApi, {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({cam:s.id, mins:mins})})).json();
    if(r && r.ok){ mode='rewind'; document.getElementById('rwtag').textContent = '▶ from ' + (r.from||'');
      mount(s, {rewind:true}); }
    else document.getElementById('rwtag').textContent = 'no recording';
  } catch(e){ document.getElementById('rwtag').textContent = 'unavailable'; }
}

function goLive(){
  mode='live'; document.getElementById('rwtag').textContent=''; markRw(0);
  fetch(C.rewindStopApi, {method:'POST'}).catch(function(){});
  mount(slides[cur]);
}

// keep the current camera centred after an orientation/size change
function rejump(){ const rail=document.getElementById('rail'); jumping=true; rail.scrollLeft=cur*rail.clientWidth;
  setTimeout(function(){ jumping=false; }, 250); }
window.addEventListener('resize', rejump);

document.getElementById('close').addEventListener('click', function(){
  fetch(C.rewindStopApi, {method:'POST'}).catch(function(){});
  slides.forEach(unmount);
  post('close');
});
document.getElementById('rw').addEventListener('click', function(e){
  const b = e.target.closest('.rwb'); if(!b) return;
  const m = parseInt(b.getAttribute('data-m'), 10);
  if(m===0) goLive(); else rewind(m);
});

// Swift calls this on dismiss-by-gesture to guarantee teardown (stop rewind + drop all consumers)
window.nazarTeardown = function(){ try{ fetch(C.rewindStopApi,{method:'POST'}); }catch(e){} slides.forEach(unmount); };

build();
if(slides.length){ openAt(Math.max(0, Math.min(C.startIndex||0, slides.length-1))); }
else { document.getElementById('name').textContent = 'No cameras'; }
</script>
</body>
</html>
"""##
