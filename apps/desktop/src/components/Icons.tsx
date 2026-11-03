// Hopilo's own interface icons: 24px grid, 1.7 stroke, round joins, with a
// soft duotone fill that appears when the icon is active (set `active`).
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };

function Icon({ size = 18, active, children, duo, ...rest }: IconProps & { duo?: ReactNode }) {
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
      aria-hidden
      {...rest}
    >
      {duo && (
        <g fill="currentColor" stroke="none" opacity={active ? 0.2 : 0} style={{ transition: "opacity 160ms ease" }}>
          {duo}
        </g>
      )}
      {children}
    </svg>
  );
}

const HOME = "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z";
export const HomeIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={HOME} />}>
    <path d={HOME} />
  </Icon>
);

const TRAY = "M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14h-4.2a1 1 0 0 0-.9.55l-.4.9a1 1 0 0 1-.9.55h-3.2a1 1 0 0 1-.9-.55l-.4-.9A1 1 0 0 0 8.2 14z";
export const CaptureIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={TRAY} />}>
    <path d="M12 4v9m0 0-3.5-3.5M12 13l3.5-3.5" />
    <path d={TRAY} />
  </Icon>
);

const FRONT = "M4 10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 2.5V17a2 2 0 0 1-2-2z";
export const SessionsIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={FRONT} />}>
    <path d="M8.5 8V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v2.2" />
    <path d={FRONT} />
  </Icon>
);

const TOP = "M12 4 3.5 8.5 12 13l8.5-4.5z";
export const PacksIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={TOP} />}>
    <path d={TOP} />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </Icon>
);

const DOC = "M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z";
export const FilesIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={DOC} />}>
    <path d={DOC} />
    <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
  </Icon>
);

export const BuildIcon = (p: IconProps) => (
  <Icon {...p} duo={<rect x="4" y="4" width="7" height="7" rx="2" />}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <path d="M16.5 13.5v6M13.5 16.5h6" />
  </Icon>
);

const PLANE = "M20.5 3.5 3.5 10.6l6.8 2.6 2.6 6.8z";
export const SendIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={PLANE} />}>
    <path d={PLANE} />
    <path d="M10.3 13.2 20.5 3.5" />
  </Icon>
);

const PLUG = "M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z";
export const ToolsIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d={PLUG} />}>
    <path d="M9 3.5v4M15 3.5v4" />
    <path d={PLUG} />
    <path d="M12 16v4.5" />
  </Icon>
);

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

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

/** Four-point spark used for Hopilo moments (welcome, empty states). */
export const SparkIcon = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2.5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8z" />
    <path d="M19 15.5c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" opacity=".6" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
);

const WIN = "M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z";
export const BrowserIcon = (p: IconProps) => (
  <Icon {...p} duo={<path d="M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V9h-17z" />}>
    <path d={WIN} />
    <path d="M3.5 9h17M6.5 6.8h.01M9 6.8h.01" />
    <path d="m10 13.5 2 2 4-4" />
  </Icon>
);

export const MapIcon = (p: IconProps) => (
  <Icon {...p} duo={<circle cx="9" cy="10" r="5.5" />}>
    <circle cx="9" cy="10" r="5.5" />
    <circle cx="17" cy="15.5" r="3.5" />
    <circle cx="16.5" cy="5.5" r="2" />
  </Icon>
);
