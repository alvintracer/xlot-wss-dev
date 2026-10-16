import { useEffect, useRef, useState } from 'react';
import { Camera, Image, X } from '@phosphor-icons/react';
import jsQR from 'jsqr';

interface Props {
  chainId: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function HostRecipientPicker({ chainId, onSelect, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = useRef(false);
  const selectRef = useRef(onSelect);
  const cancelRef = useRef(onCancel);
  selectRef.current = onSelect;
  cancelRef.current = onCancel;
  const [message, setMessage] = useState('카메라를 QR 코드에 맞춰 주세요.');

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let closed = false;
    let lastScan = 0;
    const scan = (time: number) => {
      if (closed || selected.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && time - lastScan >= 180) {
        lastScan = time;
        const width = Math.min(video.videoWidth, 600);
        const height = Math.round(video.videoHeight * width / video.videoWidth);
        if (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const value = jsQR(image.data, width, height)?.data;
            if (value && value.length <= 512) {
              selected.current = true;
              selectRef.current(value);
              return;
            }
          }
        }
      }
      frame = requestAnimationFrame(scan);
    };
    if (navigator.mediaDevices?.getUserMedia) {
      void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
        .then(async (opened) => {
          if (closed) { opened.getTracks().forEach((track) => track.stop()); return; }
          stream = opened;
          if (videoRef.current) {
            videoRef.current.srcObject = opened;
            await videoRef.current.play();
            frame = requestAnimationFrame(scan);
          }
        }).catch(() => setMessage('카메라를 열 수 없어요. QR 이미지로 불러와 주세요.'));
    } else setMessage('이 기기에서는 카메라를 사용할 수 없어요. QR 이미지로 불러와 주세요.');
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const scanFile = async (file: File | undefined) => {
    if (!file || !canvasRef.current) return;
    try {
      const objectUrl = URL.createObjectURL(file);
      const image = new window.Image();
      try {
        image.src = objectUrl;
        await image.decode();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      const width = Math.min(image.width, 1000);
      const height = Math.round(image.height * width / image.width);
      const canvas = canvasRef.current;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('canvas unavailable');
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height);
      const value = jsQR(data.data, width, height)?.data;
      if (!value || value.length > 512) throw new Error('QR not found');
      selected.current = true;
      selectRef.current(value);
    } catch { setMessage('QR 코드를 읽지 못했어요. 선명한 이미지를 선택해 주세요.'); }
  };

  return (
    <div className="host-recipient-layer" role="dialog" aria-modal="true" aria-labelledby="host-recipient-title">
      <div className="host-recipient-head">
        <div><small>{chainId === 'payment' ? '월렛 결제' : `${chainId} 네트워크`}</small><h2 id="host-recipient-title">{chainId === 'payment' ? '결제 QR 스캔' : '받는 주소 스캔'}</h2></div>
        <button ref={closeRef} type="button" aria-label="스캔 닫기" onClick={onCancel}><X aria-hidden="true" /></button>
      </div>
      <div className="host-recipient-camera"><video ref={videoRef} muted playsInline aria-label="QR 코드 카메라 화면" /><Camera size={42} aria-hidden="true" /></div>
      <canvas ref={canvasRef} hidden />
      <p role="status">{message}</p>
      <label className="host-recipient-file"><Image size={19} aria-hidden="true" /><span>QR 이미지 선택</span><input type="file" accept="image/*" capture="environment" onChange={(event) => void scanFile(event.target.files?.[0])} /></label>
      <button className="host-recipient-cancel" type="button" onClick={onCancel}>{chainId === 'payment' ? '닫기' : '직접 입력하기'}</button>
    </div>
  );
}
