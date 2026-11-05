import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };

function Icon({ size = 18, active, children, duo, style, className, ...rest }: IconProps & { duo?: ReactNode }) {
  const labelled = rest["aria-label"] != null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `ic ${className}` : "ic"}
      style={{ width: size, height: size, ...style }}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      {...rest}
    >
      {duo && (
        <g fill="currentColor" stroke="none" opacity={active ? 0.24 : 0.12} style={{ transition: "opacity 160ms ease" }}>
          {duo}
        </g>
      )}
      {children}
    </svg>
  );
}

function make(strokes: string | string[], duo?: string, extra?: ReactNode) {
  const ds = Array.isArray(strokes) ? strokes : [strokes];
  const C = (p: IconProps) => (
    <Icon {...p} duo={duo ? <path d={duo} /> : undefined}>
      {ds.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {extra}
    </Icon>
  );
  return C;
}

const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const OverviewIcon = ({ size = 20, active, className, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className ? `ic ${className}` : "ic"}
    aria-hidden="true"
    {...rest}
  >
    <rect className="s" x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2" />
    <rect className="s" x="13" y="3.5" width="7.5" height="7.5" rx="2.2" />
    <circle className="a" cx="16.75" cy="7.25" r="1.8" />
    <rect className="f" x="3.5" y="13" width="7.5" height="7.5" rx="2.2" />
    <rect className="s" x="3.5" y="13" width="7.5" height="7.5" rx="2.2" />
    <rect className="s" x="13" y="13" width="7.5" height="7.5" rx="2.2" />
  </svg>
);
export const HomeIcon = OverviewIcon;

const TRAY = "M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14h-4.2a1 1 0 0 0-.9.55l-.4.9a1 1 0 0 1-.9.55h-3.2a1 1 0 0 1-.9-.55l-.4-.9A1 1 0 0 0 8.2 14z";
export const CaptureIcon = make(["M12 4v9m0 0-3.5-3.5M12 13l3.5-3.5", TRAY], TRAY);

export const SessionsIcon = ({ size = 20, active, className, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className ? `ic ${className}` : "ic"}
    aria-hidden="true"
    {...rest}
  >
    <path
      className="f"
      d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"
    />
    <path
      className="s"
      d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"
    />
    <path className="s" d="M8 9.5h8 M8 13.5h5" />
    <circle className="a" cx="16.5" cy="13.5" r="1.4" />
  </svg>
);
export const MessagesSquare = SessionsIcon;

const TOP = "M12 4 3.5 8.5 12 13l8.5-4.5z";
export const PacksIcon = make([TOP, "m3.5 12.5 8.5 4.5 8.5-4.5", "m3.5 16.5 8.5 4.5 8.5-4.5"], TOP);

const DOC = "M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z";
const FOLD = "M14 3.5V8h4.5";
export const FilesIcon = make([DOC, FOLD, "M9 13h6M9 16.5h4"], DOC);

export const BuildIcon = make([rr(4, 4, 7, 7, 2), rr(13, 4, 7, 7, 2), rr(4, 13, 7, 7, 2), "M16.5 13.5v6M13.5 16.5h6"], rr(4, 4, 7, 7, 2));

const PLANE = "M20.5 3.5 3.5 10.6l6.8 2.6 2.6 6.8z";
export const SendIcon = make([PLANE, "M10.3 13.2 20.5 3.5"], PLANE);
export const Send = SendIcon;

const PLUG = "M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z";
export const ToolsIcon = make(["M9 3.5v4M15 3.5v4", PLUG, "M12 16v4.5"], PLUG);

export const SettingsIcon = ({ size = 20, active, className, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className ? `ic ${className}` : "ic"}
    aria-hidden="true"
    {...rest}
  >
    <path className="s" d="M4 7h9 M19 7h1 M4 17h3 M13 17h7" />
    <circle className="f" cx="16" cy="7" r="2.6" />
    <circle className="s" cx="16" cy="7" r="2.6" />
    <circle className="f" cx="10" cy="17" r="2.6" />
    <circle className="s" cx="10" cy="17" r="2.6" />
    <circle className="a" cx="16" cy="7" r="1.1" />
  </svg>
);
export const Settings = SettingsIcon;

export const SearchIcon = make([c(11, 11, 6.5), "m16 16 4 4"], c(11, 11, 6.5));
export const Search = SearchIcon;

export const BrowserIcon = ({ size = 20, active, className, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className ? `ic ${className}` : "ic"}
    aria-hidden="true"
    {...rest}
  >
    <circle className="f" cx="12" cy="12" r="9" />
    <circle className="s" cx="12" cy="12" r="9" />
    <path className="s" d="M3 12h18 M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21 M12 3C9.4 5.6 8.2 8.6 8.2 12S9.4 18.4 12 21" />
    <circle className="a" cx="16.5" cy="7.5" r="1.6" />
  </svg>
);

export const AntigravityIcon = ({ size = 20, active, className, style, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 96 96"
    fill="none"
    className={className}
    style={{ width: size, height: size, ...style }}
    aria-hidden="true"
    {...rest}
  >
    <g clipPath="url(#agy-ic-a)">
      <path
        d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z"
        fill="#3186FF"
      />
      <mask id="agy-ic-b" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="0" y="4" width="95" height="88">
        <path
          d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z"
          fill="#000"
        />
      </mask>
      <g mask="url(#agy-ic-b)">
        <g filter="url(#agy-ic-c)"><ellipse cx="25.636" cy="30.161" rx="25.636" ry="30.161" transform="rotate(96.476 44.769 9.835)" fill="#FFE432" /></g>
        <g filter="url(#agy-ic-d)"><ellipse cx="93.614" cy="23.451" rx="33.188" ry="33.918" transform="rotate(76.924 93.614 23.45)" fill="#FC413D" /></g>
        <g filter="url(#agy-ic-e)"><ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C" /></g>
        <g filter="url(#agy-ic-f)"><ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C" /></g>
        <g filter="url(#agy-ic-g)"><ellipse cx="-2.314" cy="32.19" rx="33.998" ry="37.428" transform="rotate(45.606 -2.314 32.19)" fill="#00B95C" /></g>
        <g filter="url(#agy-ic-h)"><ellipse cx="70.286" cy="101.861" rx="32.645" ry="31.436" transform="rotate(76.924 70.286 101.861)" fill="#3186FF" /></g>
        <g filter="url(#agy-ic-i)"><ellipse cx="37.762" cy="39.83" rx="37.762" ry="39.83" transform="rotate(114.176 60.204 15.464)" fill="#FBBC04" /></g>
        <g filter="url(#agy-ic-j)"><path d="M-12.05 152.344c-20.676-8.117 14.66-74.901 23.447-97.284 8.787-22.383 32.672-33.948 53.35-25.83 20.677 8.117 45.185 52.825 36.398 75.208C92.358 126.8 8.6 160.461-12.049 152.344Z" fill="#3186FF" /></g>
        <g filter="url(#agy-ic-k)"><path d="M113.238 69.22c-5.536 6.462-19.982 3.167-32.266-7.358-12.285-10.525-17.756-24.295-12.22-30.756 5.536-6.46 19.982-3.166 32.266 7.359 12.284 10.525 17.755 24.295 12.22 30.756Z" fill="#749BFF" /></g>
        <g filter="url(#agy-ic-l)"><ellipse cx="89.249" cy="10.708" rx="49.771" ry="30.939" transform="rotate(34.076 89.25 10.708)" fill="#FC413D" /></g>
        <g filter="url(#agy-ic-m)"><ellipse cx="11.494" cy="17.224" rx="26.671" ry="15.51" transform="rotate(112.516 11.494 17.224)" fill="#FFEE48" /></g>
      </g>
    </g>
    <defs>
      <filter id="agy-ic-c" x="-12.133" y="-45.923" width="77.726" height="68.909" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="4.377" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-d" x="17.408" y="-52.101" width="152.412" height="151.102" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="21.159" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-e" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-f" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-g" x="-74.079" y="-39.502" width="143.529" height="143.384" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-h" x="4.594" y="35.084" width="131.384" height="133.554" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="17.093" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-i" x="-23.316" y="-84.096" width="140.966" height="138.215" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="15.491" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-j" x="-46.111" y="-1.033" width="176.759" height="182.283" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="13.834" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-k" x="41.834" y="3.041" width="98.322" height="94.246" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="12.379" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-l" x="23.605" y="-48.077" width="131.289" height="117.57" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="10.456" result="effect1_foregroundBlur_6153_71" /></filter>
      <filter id="agy-ic-m" x="-31.984" y="-34.006" width="86.956" height="102.461" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feFlood floodOpacity="0" result="BackgroundImageFix" /><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" /><feGaussianBlur stdDeviation="12.941" result="effect1_foregroundBlur_6153_71" /></filter>
      <clipPath id="agy-ic-a"><path fill="#fff" d="M0 0h96v96H0z" /></clipPath>
    </defs>
  </svg>
);

export const MapIcon = make([c(9, 10, 5.5), c(17, 15.5, 3.5), c(16.5, 5.5, 2)], c(9, 10, 5.5));

export const SparkIcon = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2.5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8z" />
    <path d="M19 15.5c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" opacity=".6" />
  </svg>
);

export const ChevronDownIcon = make("m7 10 5 5 5-5");
export const ChevronRight = make("m10 6.5 5.5 5.5-5.5 5.5");
export const ArrowLeft = make("M19 12H5m6-6-6 6 6 6");
export const ArrowRight = make("M5 12h14m-6-6 6 6-6 6");
export const ExternalLink = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d="M10.5 4.5H6.5A2.5 2.5 0 0 0 4 7v10.5A2.5 2.5 0 0 0 6.5 20h10.5a2.5 2.5 0 0 0 2.5-2.5V13.5z" />
    <path className="s" d="M10.5 4.5H6.5A2.5 2.5 0 0 0 4 7v10.5A2.5 2.5 0 0 0 6.5 20h10.5a2.5 2.5 0 0 0 2.5-2.5V13.5" />
    <path className="s" d="M4 8.5h8" opacity={0.45} />
    <path className="s" d="M14 4.5h5.5v5.5M19.5 4.5 11 13" />
    <circle className="a" cx="19.5" cy="4.5" r="1.3" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
);
export const CheckCheck = make("m2.5 12.5 4 4 8-8.5m-4 7.5 1 1 9-9.5");
export const CheckCircle2 = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <circle className="f" cx="12" cy="12" r="8.5" />
    <circle className="s" cx="12" cy="12" r="8.5" />
    <path className="s" d="m8.5 12.3 2.5 2.5 4.8-5" strokeWidth={1.8} />
  </Icon>
);
export const XCircle = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <circle className="f" cx="12" cy="12" r="8.5" />
    <circle className="s" cx="12" cy="12" r="8.5" />
    <path className="s" d="m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6" strokeWidth={1.8} />
  </Icon>
);
export const X = make("m6.5 6.5 11 11m0-11-11 11");
export const Plus = make("M12 5v14M5 12h14");
export const Info = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <circle className="f" cx="12" cy="12" r="8.5" />
    <circle className="s" cx="12" cy="12" r="8.5" />
    <path className="s" d="M12 11v5" />
    <circle className="d" cx="12" cy="8" r="1.1" />
  </Icon>
);
export const AlertTriangle = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
    <path className="s" d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
    <path className="s" d="M12 9.5v4" />
    <circle className="d" cx="12" cy="16.6" r="1.1" />
  </Icon>
);
export const CircleDashed = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.6" />
  </Icon>
);

export const Loader2 = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
  </Icon>
);
export const RefreshCw = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="s" d="M20 12a8 8 0 0 1-13.8 5.6M4 12a8 8 0 0 1 13.8-5.6" />
    <path className="s" d="M18.5 3.5v3.8h-3.8M5.5 20.5v-3.8h3.8" />
    <circle className="a" cx="12" cy="12" r="1.4" />
  </Icon>
);
export const RotateCcw = make(["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"]);
export const History = make(["M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9", "M4.5 4.5V9H9", "M12 8v4l3 2"], c(12, 12, 7.5));
export const Power = make(["M12 3.5v8", "M7 6.5a7 7 0 1 0 10 0"]);

export const FileText = make([DOC, FOLD, "M9 12.5h6M9 16h4"], DOC);
const FilePlain = make([DOC, FOLD], DOC);
export { FilePlain as File };
export const FilePlus2 = make([DOC, FOLD, "M12 11v6M9 14h6"], DOC);
export const FileDown = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d={DOC} />
    <path className="s" d={DOC} />
    <path className="s" d={FOLD} />
    <path className="s" d="M12 10.5v6m-2.5-2.5 2.5 2.5 2.5-2.5" />
    <circle className="a" cx="12" cy="10.5" r="1.2" />
  </Icon>
);
export const FileUp = make([DOC, FOLD, "M12 17v-6m-2.5 2.5L12 11l2.5 2.5"], DOC);
export const FileImage = make([DOC, FOLD, c(10, 11.5, 1.4), "m5.8 18 3.4-3.2 2.6 2.4 2-1.7 2.9 2.5"], DOC);
export const FileArchive = make([DOC, FOLD, "M10 4.5v1.2M10 7.5v1.2M10 10.5v1.2", rr(8.6, 13.5, 2.8, 3.5, 0.9)], DOC);
export const FolderPlus = make(
  ["M3.5 7a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", "M12 10.5V16m-2.75-2.75h5.5"],
  "M3.5 7a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
);
const OPEN_FRONT = "M3.5 18 5.8 11.8a2 2 0 0 1 1.9-1.3H20a1 1 0 0 1 .95 1.3l-1.9 6.3a2 2 0 0 1-1.9 1.4H5A1.5 1.5 0 0 1 3.5 18z";
export const FolderOpen = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d="M3.5 18V6.5a2 2 0 0 1 2-2h3.6l2 2H17a2 2 0 0 1 2 2V10z" />
    <path className="s" d="M3.5 18V6.5a2 2 0 0 1 2-2h3.6l2 2H17a2 2 0 0 1 2 2V10" />
    <path className="f" d={OPEN_FRONT} />
    <path className="s" d={OPEN_FRONT} />
    <circle className="a" cx="8" cy="5.5" r="1" />
  </Icon>
);
export const Paperclip = make("M19.5 11.5 12.3 18.7a4.8 4.8 0 0 1-6.8-6.8l7.6-7.6a3.2 3.2 0 0 1 4.5 4.5l-7.6 7.6a1.6 1.6 0 0 1-2.2-2.2l7-7");
const BOARD = "M7 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z";
const CLIP = rr(8.5, 3.5, 7, 3, 1);
export const ClipboardCheck = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d={BOARD} />
    <path className="s" d="M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5" />
    <path className="s" d={CLIP} />
    <path className="s" d="m9 13.5 2 2 4-4" />
    <circle className="a" cx="12" cy="5" r="1" />
  </Icon>
);
export const ClipboardPaste = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d={BOARD} />
    <path className="s" d="M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5" />
    <path className="s" d={CLIP} />
    <path className="s" d="M12 10.5v6m-2.5-2.5 2.5 2.5 2.5-2.5" />
    <circle className="a" cx="12" cy="10.5" r="1.1" />
  </Icon>
);

export const Copy = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="s" d="M15.5 8V5.5A2.5 2.5 0 0 0 13 3H5.5A2.5 2.5 0 0 0 3 5.5v7.5A2.5 2.5 0 0 0 5.5 15.5H8" opacity={0.45} />
    <rect className="f" x="7.5" y="7.5" width="13" height="13" rx="2.8" />
    <rect className="s" x="7.5" y="7.5" width="13" height="13" rx="2.8" />
    <path className="s" d="M11 11.5h6M11 14.5h3.8" strokeWidth={1.5} />
    <circle className="a" cx="16.8" cy="14.5" r="1.1" />
  </Icon>
);
export const CopyPlus = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="s" d="M15.5 8V5.5A2.5 2.5 0 0 0 13 3H5.5A2.5 2.5 0 0 0 3 5.5v7.5A2.5 2.5 0 0 0 5.5 15.5H8" opacity={0.45} />
    <rect className="f" x="7.5" y="7.5" width="13" height="13" rx="2.8" />
    <rect className="s" x="7.5" y="7.5" width="13" height="13" rx="2.8" />
    <path className="s" d="M14 11.5v5M11.5 14h5" />
    <circle className="a" cx="14" cy="14" r="1.1" />
  </Icon>
);
export const Download = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d="M4.5 14v2.2A3.3 3.3 0 0 0 7.8 19.5h8.4a3.3 3.3 0 0 0 3.3-3.3V14z" />
    <path className="s" d="M4.5 13.5v2.7A3.3 3.3 0 0 0 7.8 19.5h8.4a3.3 3.3 0 0 0 3.3-3.3V13.5" />
    <path className="s" d="M12 4v10m-3.8-3.8 3.8 3.8 3.8-3.8" />
    <circle className="a" cx="12" cy="4" r="1.3" />
  </Icon>
);
export const Trash2 = ({ size = 18, className, style, ...rest }: IconProps) => (
  <Icon size={size} className={className} style={style} {...rest}>
    <path className="f" d="M6 6.5h12l-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9z" />
    <path className="s" d="M4 6.5h16M9.5 6.5v-2h5v2" />
    <path className="s" d="M6 6.5l.9 12.1a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5" />
    <path className="s" d="M10 10.5v5.5M14 10.5v5.5" strokeWidth={1.5} />
  </Icon>
);
export const Pencil = make(["M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z", "m13.5 6.5 3 3"], "M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z");
export const Scissors = make([c(6.5, 6.5, 2.5), c(6.5, 17.5, 2.5), "M8.6 8 19.5 17M8.6 16 19.5 7"]);
export const Hammer = make(["M10 7.5 13.5 4h3l4 4-2.5 2.5-2-2L13.5 11z", "m13.5 11-8.4 8.4a1.4 1.4 0 0 1-2-2L11.5 9"], "M10 7.5 13.5 4h3l4 4-2.5 2.5-2-2L13.5 11z");
export const Wrench = make(
  "M20 7.5a4.5 4.5 0 0 1-6.1 4.2L6.6 19a1.9 1.9 0 0 1-2.6-2.6l7.3-7.3A4.5 4.5 0 0 1 16.5 3l-2.6 2.6.5 2.5 2.5.5L19.5 6c.3.5.5 1 .5 1.5z",
  "M20 7.5a4.5 4.5 0 0 1-6.1 4.2L6.6 19a1.9 1.9 0 0 1-2.6-2.6l7.3-7.3A4.5 4.5 0 0 1 16.5 3l-2.6 2.6.5 2.5 2.5.5L19.5 6c.3.5.5 1 .5 1.5z",
);
export const SquarePlus = make([rr(4, 4, 16, 16, 3.5), "M12 8.5v7M8.5 12h7"], rr(4, 4, 16, 16, 3.5));
export const Type = make("M5 7.5V5h14v2.5M12 5v14m-2.5 0h5");
export const Archive = make([rr(3.5, 4.5, 17, 4.5, 1.2), "M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9", "M10 13h4"], "M5 9h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z");
const STAR = "M12 3.8 14.5 8.9l5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z";
export const Star = make(STAR, STAR);
export const Pin = ({ size = 18, active, filled, className, ...rest }: IconProps & { filled?: boolean }) => {
  const isFilled = filled ?? active;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <line x1="12" y1="15" x2="12" y2="21" strokeWidth={1.7} />
      <path
        d="M9 3.5h6M10 3.5h4V9l3 3.5V15H7v-2.5L10 9z"
        fill={isFilled ? "currentColor" : "none"}
      />
    </svg>
  );
};
const TAG = "M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7a2 2 0 0 1 1.4.6l7.3 7.3a2 2 0 0 1 0 2.8l-6.7 6.7a2 2 0 0 1-2.8 0L4.1 13.6a2 2 0 0 1-.6-1.4z";
export const Tag = make([TAG, "M8 8h.01"], TAG);
export const PanelBottom = make([rr(3.5, 4.5, 17, 15, 2.5), "M3.5 14.5h17"], "M3.5 14.5h17V17a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17z");
export const LayoutDashboard = make([rr(4, 4, 7, 9, 1.8), rr(13, 4, 7, 5, 1.8), rr(13, 11, 7, 9, 1.8), rr(4, 15, 7, 5, 1.8)], rr(4, 4, 7, 9, 1.8));
export const GripVertical = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    {[6, 12, 18].map((y) => (
      <g key={y}>
        <circle cx="9" cy={y} r="1.4" />
        <circle cx="15" cy={y} r="1.4" />
      </g>
    ))}
  </Icon>
);
export const MousePointerClick = make(["M9.5 9.5 19.5 13.1l-4.3 1.6-1.6 4.3z", "M5 5l1.5 1.5M9.5 3.5v2M3.5 9.5h2M5.6 13.4 7 12"], "M9.5 9.5 19.5 13.1l-4.3 1.6-1.6 4.3z");
export const ScanSearch = make(["M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2", c(11.5, 11.5, 3.5), "m14 14 2.5 2.5"], c(11.5, 11.5, 3.5));

const HEAD = rr(6, 7.5, 12, 11.5, 2.5);
export const Bot = make([HEAD, "M12 7.5V4.5", "M9.5 12.2v1.6M14.5 12.2v1.6M3.5 12v2.5M20.5 12v2.5", "M10 16.5h4"], HEAD, <circle cx="12" cy="4" r="0.9" fill="currentColor" stroke="none" />);
const CUBE_TOP = "M12 3.5 19.5 7.5 12 11.5 4.5 7.5z";
export const Boxes = make(["M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z", "M4.5 7.5 12 11.5l7.5-4M12 11.5v9"], CUBE_TOP);
export const Globe = make([c(12, 12, 8.5), "M3.5 12h17", "M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"], c(12, 12, 8.5));
const SHIELD = "M12 3.5 19 6.5v5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9v-5z";
export const ShieldCheck = make([SHIELD, "m9 12 2.2 2.2 4.3-4.3"], SHIELD);
export const ShieldAlert = make([SHIELD, "M12 8.5v4M12 15.5h.01"], SHIELD);
export const GitBranch = make([c(7, 6, 2), c(7, 18, 2), c(17, 8, 2), "M7 8v8M17 10c0 4-5 4-8.4 6.6"]);
export const GitMerge = make([c(7, 6, 2), c(7, 18, 2), c(17, 15, 2), "M7 8v8M7 8c0 4 4 7 8 7"]);
const FOLDMAP = "M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z";
const MapFold = make([FOLDMAP, "M9 4.5v13M15 6.5v13"], FOLDMAP);
export { MapFold as Map };

export const Coffee = ({ size = 16, className, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}>
    <path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3" />
  </svg>
);

export const Heart = ({ size = 16, className, fill = "currentColor", ...rest }: IconProps & { fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

export const Github = ({ size = 16, className, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} {...rest}>
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);
