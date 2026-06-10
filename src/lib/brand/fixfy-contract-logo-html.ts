/** Inline SVG wordmark for contractor agreement HTML (white / light backgrounds). */
export function fixfyContractLogoHtml(height = 38): string {
  const iconW = Math.round(height * 1.05);
  const fontSize = Math.round(height * 0.68);

  return `<div class="logo-mark" role="img" aria-label="Fixfy" style="display:inline-flex;align-items:center;gap:10px;height:${height}px">
  <svg width="${iconW}" height="${height}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#020040" transform="translate(32 33)">
      <path d="M0-20a20 20 0 0 1 17.32 30L13.4 7.74A14 14 0 1 0 0-6a14 14 0 0 0 4.94.9l5.66 9.8A20 20 0 1 1 0-20z M-3.5-19.7l-1.4-7.3 8.8 0-1.4 7.3a20 20 0 0 0-6 0z M-15.7-13l-6.4-3.7 4.4-7.6 5 5.4a20 20 0 0 0-3 5.9z M19.7-7l7.3 1.4 0 8.8-7.3-1.4a20 20 0 0 0 0-8.8z M15.7 13l6.4 3.7-4.4 7.6-5-5.4a20 20 0 0 0 3-5.9z"/>
      <g transform="rotate(35)">
        <rect x="-1.5" y="-14" width="3" height="20" rx="1"/>
        <rect x="-8" y="-18" width="16" height="7" rx="1.5"/>
      </g>
    </g>
  </svg>
  <span style="font-size:${fontSize}px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-family:Arial,Helvetica,sans-serif">
    <span style="color:#020040">fix</span><span style="color:#ED4B00">fy</span>
  </span>
</div>`;
}
