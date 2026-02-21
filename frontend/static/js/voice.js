/* ── voice.js — Whisper STT + TTS ───────────────────────────── */
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ── TTS ─────────────────────────────────────────────────────────
async function speakText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.innerText.slice(0, 1000); // limit TTS length
  if (!text.trim()) return;
  showToast('🔊 Озвучиваю...', 'success');
  try {
    const data = await api.tts(text, currentLang);
    if (data.audio_base64) {
      const audio = new Audio('data:audio/mp3;base64,' + data.audio_base64);
      audio.play();
    }
  } catch (e) {
    showToast('TTS ошибка: ' + e.message, 'error');
  }
}

// ── STT (voice input for any field) ─────────────────────────────
async function startRecording(targetInputId, btnEl) {
  if (isRecording) {
    stopRecording(btnEl);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', blob, 'voice.wav');
      formData.append('language', currentLang);
      try {
        showToast('🎙️ Распознаю речь...', 'success');
        const result = await api.stt(formData);
        const input = document.getElementById(targetInputId);
        if (input) {
          input.value = (input.value + ' ' + result.text).trim();
        }
        showToast('✅ ' + result.text, 'success');
      } catch (e) {
        showToast('STT ошибка: ' + e.message, 'error');
      }
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    isRecording = true;
    if (btnEl) btnEl.classList.add('voice-recording');
    showToast('🎙️ Запись...', 'success');
  } catch (e) {
    showToast('Нет доступа к микрофону: ' + e.message, 'error');
  }
}

function stopRecording(btnEl) {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    if (btnEl) btnEl.classList.remove('voice-recording');
  }
}

// Code review voice input
function toggleVoiceInput() {
  const btn = document.getElementById('voiceInputBtn');
  startRecording('codeInput', btn);
}

// Chat voice input
function toggleVoiceChat() {
  const btn = document.getElementById('voiceChatBtn');
  startRecording('chatInput', btn);
}
