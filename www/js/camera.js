export function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read selected image'));
    reader.readAsDataURL(file);
  });
}

export function compressImageDataUrl(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / Math.max(img.width, 1);
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error('Failed to process image'));
    img.src = dataUrl;
  });
}

export function captureCameraPhoto() {
  return new Promise((resolve, reject) => {
    if (!navigator.camera) {
      captureWithLiveCamera().then(resolve).catch(reject);
      return;
    }

    navigator.camera.getPicture(
      (imageData) => resolve(`data:image/jpeg;base64,${imageData}`),
      (error) => {
        if (error && error !== 'Camera cancelled.') {
          reject(new Error('Camera permission or capture was denied.'));
          return;
        }
        reject(new Error('Camera request was cancelled.'));
      },
      {
        quality: 80,
        destinationType: Camera.DestinationType.DATA_URL,
        sourceType: Camera.PictureSourceType.CAMERA,
        encodingType: Camera.EncodingType.JPEG,
        targetWidth: 800,
        correctOrientation: true,
        saveToPhotoAlbum: false
      }
    );
  });
}

function captureWithLiveCamera() {
  return new Promise(async (resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(new Error('Native camera is unavailable. Please install the latest APK and allow camera permission.'));
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (error) {
      reject(new Error('Camera permission was denied or the camera is unavailable.'));
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'camera-capture-backdrop';
    backdrop.innerHTML = `
      <div class="camera-capture-panel">
        <video class="camera-capture-video" autoplay playsinline></video>
        <div class="camera-capture-actions">
          <button type="button" class="secondary-btn" data-camera-cancel>Cancel</button>
          <button type="button" class="primary-btn" data-camera-capture>Take photo</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const video = backdrop.querySelector('video');
    video.srcObject = stream;

    const cleanup = () => {
      stream.getTracks().forEach((track) => track.stop());
      backdrop.remove();
    };

    backdrop.querySelector('[data-camera-cancel]').addEventListener('click', () => {
      cleanup();
      reject(new Error('Camera request was cancelled.'));
    });
    backdrop.querySelector('[data-camera-capture]').addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', 0.88);
      cleanup();
      resolve(image);
    });
  });
}

export function chooseImageFromGallery() {
  return new Promise((resolve, reject) => {
    if (!navigator.camera) {
      chooseImageFromInput(false).then(resolve).catch(reject);
      return;
    }

    navigator.camera.getPicture(
      (imageData) => resolve(`data:image/jpeg;base64,${imageData}`),
      (error) => {
        if (error && error !== 'Camera cancelled.') {
          reject(new Error('Gallery access was denied or unavailable.'));
          return;
        }
        reject(new Error('No image was selected.'));
      },
      {
        quality: 85,
        destinationType: Camera.DestinationType.DATA_URL,
        sourceType: Camera.PictureSourceType.PHOTOLIBRARY,
        encodingType: Camera.EncodingType.JPEG,
        targetWidth: 800,
        correctOrientation: true
      }
    );
  });
}

function chooseImageFromInput(useCamera) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        reject(new Error('No image was selected.'));
        return;
      }
      imageToDataUrl(file).then((dataUrl) => {
        cleanup();
        resolve(dataUrl);
      }).catch((error) => {
        cleanup();
        reject(error);
      });
    }, { once: true });
    input.click();
  });
}
