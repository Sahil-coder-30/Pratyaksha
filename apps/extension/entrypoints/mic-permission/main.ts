// Asks for mic access from a normal tab, since the side panel cannot show the
// prompt. Once granted, the extension origin keeps it for the side panel too.
const status = document.querySelector<HTMLElement>("#status");

navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    stream.getTracks().forEach((track) => track.stop());
    if (status) status.textContent = "Microphone allowed. Go back to BigFish and tap the mic again.";
    setTimeout(() => window.close(), 1500);
  })
  .catch(() => {
    if (status) {
      status.textContent =
        "Microphone was blocked. Click the icon at the right of the address bar, allow the microphone, then reload this page.";
    }
  });
