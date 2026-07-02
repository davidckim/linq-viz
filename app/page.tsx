import QRCode from 'qrcode';

const VIZ_NUMBER = process.env.LINQ_PHONE_NUMBER;

const VIDEO_URL =
  'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/items/1868140/2ca662e6359bf4e940c6be30ab6a0410f2ea6d7d.webm';

const smsBody = encodeURIComponent(
  'Hey Viz, how are the diving conditions at Malaga Cove this Thursday?',
);

const smsUrl = `sms:${VIZ_NUMBER}?body=${smsBody}`;

const qrDataUrl = await QRCode.toDataURL(smsUrl, {
  width: 220,
  margin: 2,
  color: { dark: '#0a1628', light: '#f0f8ff' },
});

export default async function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={VIDEO_URL} type="video/webm" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-white/10 bg-black/50 px-10 py-10 text-center backdrop-blur-md">
          <div className="flex flex-col items-center gap-3">
            <span className="font-pixel text-5xl text-white drop-shadow-[0_0_24px_rgba(56,189,248,0.6)]">
              VIZ
            </span>
            <span className="font-pixel text-[8px] leading-relaxed text-white/40">
              SPEARFISHING CONDITIONS
            </span>
          </div>
          <img
            src={qrDataUrl}
            alt="Scan to text Viz"
            width={200}
            height={200}
            className="rounded-lg"
          />
          <div className="flex flex-col gap-3 font-pixel">
            <p className="text-[10px] text-white">SCAN TO TEXT VIZ</p>
            <p className="max-w-[220px] text-[8px] leading-loose text-white/60">
              SEND A DIVE SPOT + DATE.
              <br />
              GET CONDITIONS BACK.
            </p>
          </div>
          <a
            href={smsUrl}
            className="font-pixel text-[8px] text-white/25 transition-colors hover:text-white/50"
          >
            {VIZ_NUMBER}
          </a>
        </div>
      </div>
    </div>
  );
}
