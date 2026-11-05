import type { ReactNode } from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

function ChatGptLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 9.186a4.48 4.48 0 0 1 2.366-1.973V12.8a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 9.186zm16.597 3.855-5.833-3.387L15.119 8.5a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 10.52V8.188a.08.08 0 0 1 .033-.061l4.839-2.79a4.5 4.5 0 0 1 6.68 4.66v.062zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V7.248a4.5 4.5 0 0 1 7.37-3.453l-.142.08L8.7 6.633a.787.787 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.607 1.5-2.602-1.5z" />
    </svg>
  );
}

function ClaudeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

function GeminiLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  );
}

function CodexLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M9.064 3.344a4.578 4.578 0 0 1 2.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 0 0 .043 0 4.55 4.55 0 0 1 3.046.275l.047.022.116.057a4.581 4.581 0 0 1 2.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 0 1-.134 1.223.123.123 0 0 0 .03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 0 1-2.201 1.388.123.123 0 0 0-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 0 0-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 0 1-1.945-.466 4.544 4.544 0 0 1-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 0 1-.37-.961 4.582 4.582 0 0 1-.014-2.298.124.124 0 0 0 .006-.056.085.085 0 0 0-.027-.048 4.467 4.467 0 0 1-1.034-1.651 3.896 3.896 0 0 1-.251-1.192 5.189 5.189 0 0 1 .141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 0 0 .065-.066 4.51 4.51 0 0 1 .829-1.615 4.535 4.535 0 0 1 1.837-1.388zm3.482 10.565a.637.637 0 0 0 0 1.272h3.636a.637.637 0 1 0 0-1.272h-3.636zM8.462 9.23a.637.637 0 0 0-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 1 0 1.095.649l1.454-2.455a.636.636 0 0 0 .005-.64L8.462 9.23z" />
    </svg>
  );
}

function OpenCodeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 20" fill="currentColor" className={className}>
      <path d="M12 16H4V8H12V16Z" opacity="0.35" />
      <path fillRule="evenodd" clipRule="evenodd" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" />
    </svg>
  );
}

function DeepSeekLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" />
    </svg>
  );
}

function PerplexityLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" />
    </svg>
  );
}

function QwenLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z" />
    </svg>
  );
}

function GrokLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

function AiderLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.5 4.5h-15a2.5 2.5 0 0 0-2.5 2.5v10a2.5 2.5 0 0 0 2.5 2.5h15a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5zm-11 11.2h-2.2l3.4-7.4h1.6l3.4 7.4h-2.2l-.6-1.5h-2.8zm2.2-3.2-.8-2-.8 2zm5.8 3.2h-2.1V8.3h2.1z" />
    </svg>
  );
}

function CursorLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  );
}

function ZedLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M2.93144 1.95429C2.39177 1.95429 1.95429 2.39177 1.95429 2.93144V24.4286H0V2.93144C0 1.31245 1.31245 0 2.93144 0H29.112C30.4178 0 31.0718 1.57879 30.1484 2.50214L14.0237 18.6268H18.5658V16.6115H20.5201V19.1154C20.5201 19.9249 19.8638 20.5811 19.0543 20.5811H12.0694L8.71049 23.9401H23.9401V11.7257H25.8944V23.9401C25.8944 25.0194 25.0194 25.8944 23.9401 25.8944H6.7562L3.33618 29.3144H28.3372C28.8769 29.3144 29.3144 28.8769 29.3144 28.3372V6.84002H31.2687V28.3372C31.2687 29.9562 29.9562 31.2687 28.3372 31.2687H2.15667C0.850848 31.2687 0.196896 29.6899 1.12024 28.7665L17.1839 12.7029H12.7029V14.6572H10.7486V12.2143C10.7486 11.4048 11.4048 10.7486 12.2143 10.7486H19.1382L22.5582 7.32859H7.32859V19.5429H5.3743V7.32859C5.3743 6.24927 6.24927 5.3743 7.32859 5.3743H24.5125L27.9325 1.95429H2.93144Z" />
    </svg>
  );
}

function ClipboardLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="6" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H9V4z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function NoteLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="2" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function AntigravityLogo({ size = 16, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g clipPath="url(#agy-a)">
        <path
          d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z"
          fill="#3186FF"
        />
        <mask id="agy-b" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="0" y="4" width="95" height="88">
          <path
            d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z"
            fill="#000"
          />
        </mask>
        <g mask="url(#agy-b)">
          <g filter="url(#agy-c)">
            <ellipse cx="25.636" cy="30.161" rx="25.636" ry="30.161" transform="rotate(96.476 44.769 9.835)" fill="#FFE432" />
          </g>
          <g filter="url(#agy-d)">
            <ellipse cx="93.614" cy="23.451" rx="33.188" ry="33.918" transform="rotate(76.924 93.614 23.45)" fill="#FC413D" />
          </g>
          <g filter="url(#agy-e)">
            <ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C" />
          </g>
          <g filter="url(#agy-f)">
            <ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C" />
          </g>
          <g filter="url(#agy-g)">
            <ellipse cx="-2.314" cy="32.19" rx="33.998" ry="37.428" transform="rotate(45.606 -2.314 32.19)" fill="#00B95C" />
          </g>
          <g filter="url(#agy-h)">
            <ellipse cx="70.286" cy="101.861" rx="32.645" ry="31.436" transform="rotate(76.924 70.286 101.861)" fill="#3186FF" />
          </g>
          <g filter="url(#agy-i)">
            <ellipse cx="37.762" cy="39.83" rx="37.762" ry="39.83" transform="rotate(114.176 60.204 15.464)" fill="#FBBC04" />
          </g>
          <g filter="url(#agy-j)">
            <path
              d="M-12.05 152.344c-20.676-8.117 14.66-74.901 23.447-97.284 8.787-22.383 32.672-33.948 53.35-25.83 20.677 8.117 45.185 52.825 36.398 75.208C92.358 126.8 8.6 160.461-12.049 152.344Z"
              fill="#3186FF"
            />
          </g>
          <g filter="url(#agy-k)">
            <path
              d="M113.238 69.22c-5.536 6.462-19.982 3.167-32.266-7.358-12.285-10.525-17.756-24.295-12.22-30.756 5.536-6.46 19.982-3.166 32.266 7.359 12.284 10.525 17.755 24.295 12.22 30.756Z"
              fill="#749BFF"
            />
          </g>
          <g filter="url(#agy-l)">
            <ellipse cx="89.249" cy="10.708" rx="49.771" ry="30.939" transform="rotate(34.076 89.25 10.708)" fill="#FC413D" />
          </g>
          <g filter="url(#agy-m)">
            <ellipse cx="11.494" cy="17.224" rx="26.671" ry="15.51" transform="rotate(112.516 11.494 17.224)" fill="#FFEE48" />
          </g>
        </g>
      </g>
      <defs>
        <filter id="agy-c" x="-12.133" y="-45.923" width="77.726" height="68.909" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="4.377" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-d" x="17.408" y="-52.101" width="152.412" height="151.102" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="21.159" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-e" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-f" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-g" x="-74.079" y="-39.502" width="143.529" height="143.384" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-h" x="4.594" y="35.084" width="131.384" height="133.554" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="17.093" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-i" x="-23.316" y="-84.096" width="140.966" height="138.215" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="15.491" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-j" x="-46.111" y="-1.033" width="176.759" height="182.283" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="13.834" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-k" x="41.834" y="3.041" width="98.322" height="94.246" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="12.379" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-l" x="23.605" y="-48.077" width="131.289" height="117.57" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="10.456" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <filter id="agy-m" x="-31.984" y="-34.006" width="86.956" height="102.461" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="12.941" result="effect1_foregroundBlur_6153_71" />
        </filter>
        <clipPath id="agy-a">
          <path fill="#fff" d="M0 0h96v96H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

const LOGO_MAP: Record<string, (props: LogoProps) => ReactNode> = {
  antigravity: AntigravityLogo,
  chatgpt: ChatGptLogo,
  claude: ClaudeLogo,
  "claude-code": ClaudeLogo,
  gemini: GeminiLogo,
  "gemini-cli": GeminiLogo,
  codex: CodexLogo,
  opencode: OpenCodeLogo,
  deepseek: DeepSeekLogo,
  perplexity: PerplexityLogo,
  "qwen-code": QwenLogo,
  grok: GrokLogo,
  aider: AiderLogo,
  cursor: CursorLogo,
  "cursor-cli": CursorLogo,
  zed: ZedLogo,
  clipboard: ClipboardLogo,
  manual: NoteLogo,
  file: NoteLogo,
};

export function ProviderLogo({
  id,
  size = 16,
  className,
  fallback,
}: {
  id: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const normalizedId = id.toLowerCase().trim();
  const Component = LOGO_MAP[normalizedId];

  if (Component) {
    return <Component size={size} className={className} />;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l2.4 6.9 6.9 2.4-6.9 2.4L12 20.6l-2.4-6.9L2.7 11.3l6.9-2.4L12 2z" />
    </svg>
  );
}
