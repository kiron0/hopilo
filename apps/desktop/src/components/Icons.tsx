// Hopilo's own interface icons, drawn for this app: 24px grid, 1.7 stroke,
// round caps and joins, and a soft duotone fill (`duo`) that is always faintly
// present and deepens when the icon is active (set `active`). Every icon in
// the dashboard and menu-bar panel comes from this file.
import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };

function Icon({ size = 18, active, children, duo, ...rest }: IconProps & { duo?: ReactNode }) {
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

/** Builds an icon from stroke paths and an optional duotone fill path. */
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

/** Circle as a path, so circles can share the stroke/duo helpers. */
const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
/** Rounded rectangle as a path. */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

// ---- navigation ------------------------------------------------------------

const HOME = "M4 10.8 12 4.3l8 6.5v8.2a1.5 1.5 0 0 1-1.5 1.5H15v-5.2a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.2H5.5A1.5 1.5 0 0 1 4 19z";
export const HomeIcon = make(HOME, HOME);

const TRAY = "M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14h-4.2a1 1 0 0 0-.9.55l-.4.9a1 1 0 0 1-.9.55h-3.2a1 1 0 0 1-.9-.55l-.4-.9A1 1 0 0 0 8.2 14z";
export const CaptureIcon = make(["M12 4v9m0 0-3.5-3.5M12 13l3.5-3.5", TRAY], TRAY);

const FRONT = "M4 10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 2.5V17a2 2 0 0 1-2-2z";
export const SessionsIcon = make(["M8.5 8V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v2.2", FRONT], FRONT);
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

export const SettingsIcon = (p: IconProps) => (
  <Icon
    {...p}
    duo={
      <>
        <circle cx="15" cy="7" r="2.2" />
        <circle cx="9" cy="17" r="2.2" />
      </>
    }
  >
    <path d="M4 7h8.8M17.2 7H20M4 17h2.8M11.2 17H20" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </Icon>
);
export const Settings = SettingsIcon;

export const SearchIcon = make([c(11, 11, 6.5), "m16 16 4 4"], c(11, 11, 6.5));
export const Search = SearchIcon;

const WIN = "M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z";
export const BrowserIcon = make([WIN, "M3.5 9h17M6.5 6.8h.01M9 6.8h.01", "m10 13.5 2 2 4-4"], "M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V9h-17z");

export const MapIcon = make([c(9, 10, 5.5), c(17, 15.5, 3.5), c(16.5, 5.5, 2)], c(9, 10, 5.5));

/** Four-point spark used for Hopilo moments (welcome, empty states). */
export const SparkIcon = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2.5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8z" />
    <path d="M19 15.5c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" opacity=".6" />
  </svg>
);

// ---- direction & state ------------------------------------------------------

export const ChevronDownIcon = make("m7 10 5 5 5-5");
export const ChevronRight = make("m10 6.5 5.5 5.5-5.5 5.5");
export const ArrowLeft = make("M19 12H5m6-6-6 6 6 6");
export const ArrowRight = make("M5 12h14m-6-6 6 6-6 6");
export const ExternalLink = make(["M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5", "M14 4h6v6m0-6-9 9"], "M10.5 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5z");

export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
);
export const CheckCheck = make("m2.5 12.5 4 4 8-8.5m-4 7.5 1 1 9-9.5");
export const CheckCircle2 = make([c(12, 12, 8.5), "m8.5 12.3 2.5 2.5 4.8-5"], c(12, 12, 8.5));
export const XCircle = make([c(12, 12, 8.5), "m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6"], c(12, 12, 8.5));
export const X = make("m6.5 6.5 11 11m0-11-11 11");
export const Plus = make("M12 5v14M5 12h14");
export const Info = make([c(12, 12, 8.5), "M12 11v5M12 8h.01"], c(12, 12, 8.5));
export const AlertTriangle = make(
  ["M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z", "M12 9.5v4M12 16.6h.01"],
  "M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z",
);
export const CircleDashed = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.6" />
  </Icon>
);
/** Spinner: a three-quarter arc; spin it with `animate-spin`. */
export const Loader2 = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
  </Icon>
);
export const RefreshCw = make(["M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3", "M18 3v3.7h-3.7M6 21v-3.7h3.7"]);
export const History = make(["M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9", "M4.5 4.5V9H9", "M12 8v4l3 2"], c(12, 12, 7.5));
export const Power = make(["M12 3.5v8", "M7 6.5a7 7 0 1 0 10 0"]);

// ---- documents & files -------------------------------------------------------

export const FileText = make([DOC, FOLD, "M9 12.5h6M9 16h4"], DOC);
const FilePlain = make([DOC, FOLD], DOC);
export { FilePlain as File };
export const FilePlus2 = make([DOC, FOLD, "M12 11v6M9 14h6"], DOC);
export const FileDown = make([DOC, FOLD, "M12 10.5v6m-2.5-2.5 2.5 2.5 2.5-2.5"], DOC);
export const FileUp = make([DOC, FOLD, "M12 17v-6m-2.5 2.5L12 11l2.5 2.5"], DOC);
export const FileImage = make([DOC, FOLD, c(10, 11.5, 1.4), "m5.8 18 3.4-3.2 2.6 2.4 2-1.7 2.9 2.5"], DOC);
export const FileArchive = make([DOC, FOLD, "M10 4.5v1.2M10 7.5v1.2M10 10.5v1.2", rr(8.6, 13.5, 2.8, 3.5, 0.9)], DOC);
export const FolderPlus = make(
  ["M3.5 7a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", "M12 10.5V16m-2.75-2.75h5.5"],
  "M3.5 7a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
);
const OPEN_FRONT = "M3.5 18 5.8 11.8a2 2 0 0 1 1.9-1.3H20a1 1 0 0 1 .95 1.3l-1.9 6.3a2 2 0 0 1-1.9 1.4H5A1.5 1.5 0 0 1 3.5 18z";
export const FolderOpen = make(["M3.5 18V6.5a2 2 0 0 1 2-2h3.6l2 2H17a2 2 0 0 1 2 2V10", OPEN_FRONT], OPEN_FRONT);
export const Paperclip = make("M19.5 11.5 12.3 18.7a4.8 4.8 0 0 1-6.8-6.8l7.6-7.6a3.2 3.2 0 0 1 4.5 4.5l-7.6 7.6a1.6 1.6 0 0 1-2.2-2.2l7-7");
const BOARD = "M7 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z";
const CLIP = rr(8.5, 3.5, 7, 3, 1);
export const ClipboardCheck = make(["M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5", CLIP, "m9 13.5 2 2 4-4"], BOARD);
export const ClipboardPaste = make(["M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5", CLIP, "M12 10v6.5m-2.5-2.5 2.5 2.5 2.5-2.5"], BOARD);

// ---- actions -----------------------------------------------------------------

const COPY_FRONT = rr(8.5, 8.5, 11.5, 11.5, 2.2);
export const Copy = make([COPY_FRONT, "M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"], COPY_FRONT);
export const CopyPlus = make([COPY_FRONT, "M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5", "M14.25 11.5v5.5m-2.75-2.75h5.5"], COPY_FRONT);
export const Download = make(["M12 4v10.5m-4.5-4.5 4.5 4.5 4.5-4.5", "M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5"], "M4.5 15.5h15V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z");
export const Trash2 = make(["M4 6.5h16M9.5 6.5v-2h5v2", "M6 6.5l.9 12.1a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5", "M10 10.5v6M14 10.5v6"], "M6 6.5h12l-.9 12.1a2 2 0 0 1-2 1.9H8.9a2 2 0 0 1-2-1.9z");
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
const PIN = "M10 3.5h4V9l3 3.5V14H7v-1.5L10 9z";
export const Pin = make(["M9 3.5h6", PIN, "M12 14v6.5"], PIN);
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

// ---- things --------------------------------------------------------------------

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
