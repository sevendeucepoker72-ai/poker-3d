import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../../services/socketService';
import './VoiceChat.css';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function VoiceChat({ tableId, username, visible }) {
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState({}); // socketId -> { username, speaking }
  const [minimized, setMinimized] = useState(false);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // socketId -> RTCPeerConnection
  const analyserNodesRef = useRef({}); // socketId -> AnalyserNode
  const audioContextRef = useRef(null);
  const speakingTimersRef = useRef({}); // socketId -> animationFrameId
  const localAnalyserRef = useRef(null);
  const localSpeakingTimerRef = useRef(null);
  const [localSpeaking, setLocalSpeaking] = useState(false);

  const socket = getSocket();

  // ---- Speaking detection ----
  const startSpeakingDetection = useCallback((socketId, stream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyserNodesRef.current[socketId] = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = avg > 10;
      setPeers(prev => {
        if (!prev[socketId]) return prev;
        if (prev[socketId].speaking === speaking) return prev;
        return { ...prev, [socketId]: { ...prev[socketId], speaking } };
      });
      speakingTimersRef.current[socketId] = requestAnimationFrame(check);
    };
    speakingTimersRef.current[socketId] = requestAnimationFrame(check);
  }, []);

  const startLocalSpeakingDetection = useCallback((stream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    localAnalyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLocalSpeaking(avg > 10);
      localSpeakingTimerRef.current = requestAnimationFrame(check);
    };
    localSpeakingTimerRef.current = requestAnimationFrame(check);
  }, []);

  const stopSpeakingDetection = useCallback((socketId) => {
    if (speakingTimersRef.current[socketId]) {
      cancelAnimationFrame(speakingTimersRef.current[socketId]);
      delete speakingTimersRef.current[socketId];
    }
    delete analyserNodesRef.current[socketId];
  }, []);

  // ---- Peer connection helpers ----
  const createPeerConnection = useCallback((socketId, peerUsername) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('voiceIce', { to: socketId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.play().catch(() => {});
      startSpeakingDetection(socketId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        removePeer(socketId);
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peerConnectionsRef.current[socketId] = pc;
    setPeers(prev => ({ ...prev, [socketId]: { username: peerUsername, speaking: false } }));
    return pc;
  }, [socket, startSpeakingDetection]);

  const removePeer = useCallback((socketId) => {
    const pc = peerConnectionsRef.current[socketId];
    if (pc) {
      pc.close();
      delete peerConnectionsRef.current[socketId];
    }
    stopSpeakingDetection(socketId);
    setPeers(prev => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, [stopSpeakingDetection]);

  // ---- Join / Leave ----
  const joinVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      startLocalSpeakingDetection(stream);
      socket.emit('voiceJoin', { tableId, username });
      setJoined(true);
      joinedRef.current = true;
    } catch (err) {
      console.error('VoiceChat: getUserMedia failed', err);
    }
  }, [socket, tableId, username, startLocalSpeakingDetection]);

  const leaveVoice = useCallback(() => {
    socket.emit('voiceLeave', { tableId });

    // Close all peer connections
    Object.keys(peerConnectionsRef.current).forEach(id => removePeer(id));

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    if (localSpeakingTimerRef.current) {
      cancelAnimationFrame(localSpeakingTimerRef.current);
    }
    localAnalyserRef.current = null;
    setLocalSpeaking(false);
    setJoined(false);
    joinedRef.current = false;
    setPeers({});
  }, [socket, tableId, removePeer]);

  // ---- Mute ----
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = muted; // toggling: if currently muted, re-enable
      });
    }
    setMuted(prev => !prev);
  }, [muted]);

  // ---- Socket event handlers ----
  useEffect(() => {
    if (!socket) return;

    const handlePeerJoined = async ({ from, username: peerUsername }) => {
      if (!joined) return;
      const pc = createPeerConnection(from, peerUsername);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voiceOffer', { to: from, offer, username });
      } catch (err) {
        console.error('VoiceChat: createOffer failed', err);
      }
    };

    const handlePeerLeft = ({ socketId }) => {
      removePeer(socketId);
    };

    const handleOffer = async ({ from, offer, username: peerUsername }) => {
      if (!joined) return;
      const pc = createPeerConnection(from, peerUsername);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voiceAnswer', { to: from, answer });
      } catch (err) {
        console.error('VoiceChat: handle offer failed', err);
      }
    };

    const handleAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('VoiceChat: setRemoteDescription (answer) failed', err);
        }
      }
    };

    const handleIce = async ({ from, candidate }) => {
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('VoiceChat: addIceCandidate failed', err);
        }
      }
    };

    socket.on('voicePeerJoined', handlePeerJoined);
    socket.on('voicePeerLeft', handlePeerLeft);
    socket.on('voiceOffer', handleOffer);
    socket.on('voiceAnswer', handleAnswer);
    socket.on('voiceIce', handleIce);

    return () => {
      socket.off('voicePeerJoined', handlePeerJoined);
      socket.off('voicePeerLeft', handlePeerLeft);
      socket.off('voiceOffer', handleOffer);
      socket.off('voiceAnswer', handleAnswer);
      socket.off('voiceIce', handleIce);
    };
  }, [socket, joined, username, createPeerConnection, removePeer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedRef.current) leaveVoice();
    };
  }, [leaveVoice]);

  if (!visible) return null;

  const peerList = Object.entries(peers);

  return (
    <div className={`voice-chat-panel${minimized ? ' minimized' : ''}`}>
      <div className="voice-chat-header">
        <span className="voice-chat-title">
          <span className="voice-mic-icon">🎙</span> Voice
          {joined && <span className="voice-live-dot" />}
        </span>
        <div className="voice-header-actions">
          <button
            className="voice-btn-icon"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="voice-chat-body">
          {/* Local user row */}
          <div className={`voice-peer-row voice-peer-local${localSpeaking && !muted ? ' speaking' : ''}`}>
            <div className="voice-avatar">{username.charAt(0).toUpperCase()}</div>
            <span className="voice-peer-name">{username} <em>(you)</em></span>
            {muted && <span className="voice-muted-badge">muted</span>}
          </div>

          {/* Remote peers */}
          {peerList.map(([socketId, peer]) => (
            <div
              key={socketId}
              className={`voice-peer-row${peer.speaking ? ' speaking' : ''}`}
            >
              <div className="voice-avatar">{peer.username.charAt(0).toUpperCase()}</div>
              <span className="voice-peer-name">{peer.username}</span>
            </div>
          ))}

          {joined && peerList.length === 0 && (
            <p className="voice-empty">No other players in voice</p>
          )}

          {/* Controls */}
          <div className="voice-controls">
            {joined ? (
              <>
                <button
                  className={`voice-btn${muted ? ' muted' : ''}`}
                  onClick={toggleMute}
                >
                  {muted ? '🔇 Unmute' : '🎤 Mute'}
                </button>
                <button className="voice-btn voice-btn-leave" onClick={leaveVoice}>
                  Leave
                </button>
              </>
            ) : (
              <button className="voice-btn voice-btn-join" onClick={joinVoice}>
                Join Voice
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
