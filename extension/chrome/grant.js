/* IMC Audio Router, Chrome / Edge: one-time permission page. Chrome only shows audio device names to pages that were allowed the microphone once.
   We ask, release the microphone immediately, and record nothing. */
document.getElementById('go').onclick = async () => {
  const out = document.getElementById('out');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());   // let go straight away; nothing was recorded
    const names = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.label).length;
    out.className = 'ok'; out.textContent = 'Done: ' + names + ' device names are visible now. You can close this tab and open the extension again.';
  } catch (e) { out.className = 'bad'; out.textContent = 'Not allowed (' + e.name + '). Allow the microphone for this extension in the address bar, then try again.'; }
};
