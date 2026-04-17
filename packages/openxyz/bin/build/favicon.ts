import sharp from "sharp";

export const FAVICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="24" height="24" fill="black"/>
<path d="M7.4686 3L11.9324 10.4883H12.0676L16.5314 3H19L13.5556 12L19 21H16.5314L12.0676 13.6523H11.9324L7.4686 21H5L10.5797 12L5 3H7.4686Z" fill="white"/>
<path d="M20 12C20 13.8479 19.6549 15.4449 18.9646 16.7909C18.2743 18.1369 17.3274 19.1749 16.1239 19.9049C14.9204 20.635 13.5457 21 12 21C10.4543 21 9.07965 20.635 7.87611 19.9049C6.67257 19.1749 5.72566 18.1369 5.0354 16.7909C4.34513 15.4449 4 13.8479 4 12C4 10.1521 4.34513 8.55513 5.0354 7.20913C5.72566 5.86312 6.67257 4.8251 7.87611 4.09506C9.07965 3.36502 10.4543 3 12 3C13.5457 3 14.9204 3.36502 16.1239 4.09506C17.3274 4.8251 18.2743 5.86312 18.9646 7.20913C19.6549 8.55513 20 10.1521 20 12ZM17.8761 12C17.8761 10.4829 17.6136 9.20247 17.0885 8.15875C16.5693 7.11502 15.8643 6.3251 14.9735 5.78897C14.0885 5.25285 13.0973 4.98479 12 4.98479C10.9027 4.98479 9.90855 5.25285 9.0177 5.78897C8.13274 6.3251 7.42773 7.11502 6.90265 8.15875C6.38348 9.20247 6.12389 10.4829 6.12389 12C6.12389 13.5171 6.38348 14.7975 6.90265 15.8413C7.42773 16.885 8.13274 17.6749 9.0177 18.211C9.90855 18.7471 10.9027 19.0152 12 19.0152C13.0973 19.0152 14.0885 18.7471 14.9735 18.211C15.8643 17.6749 16.5693 16.885 17.0885 15.8413C17.6136 14.7975 17.8761 13.5171 17.8761 12Z" fill="white"/>
</svg>
`;

/**
 * Render the inline SVG to a 32×32 PNG via sharp, then wrap it in an ICO
 * container. Modern browsers accept PNG-embedded ICOs — same approach aixyz
 * uses (packages/aixyz-cli/build/icons.ts).
 */
export async function generateFaviconIco(svg: string): Promise<Uint8Array> {
  const png = await sharp(Buffer.from(svg))
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + PNG payload.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // color count (0 = true color)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(22, 12); // image data offset (6 + 16)

  return Buffer.concat([header, entry, png]);
}
