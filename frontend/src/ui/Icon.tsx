const PATHS = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10",
  review: "M4 5.5h16M4 10.5h10M4 15.5h7M16.5 19.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm2.6-1 2.4 2.4",
  clean: "M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7L4.5 10.9 10.2 9 12 3.5ZM19 16.5v4M17 18.5h4",
  history: "M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5M12 8v4.5l3 1.5",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM9 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  folder: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19A1.5 1.5 0 0 1 20.5 9.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z",
  branch: "M6.5 8.5v7M6.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11-12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 0c0 4-11 3-11 7",
  check: "M5 12.5 10 17.5 19.5 7",
  close: "M6 6l12 12M18 6 6 18",
  alert: "M12 8.5v5M12 16.5v.5M10.6 4.3 3 18a1.6 1.6 0 0 0 1.4 2.4h15.2A1.6 1.6 0 0 0 21 18L13.4 4.3a1.6 1.6 0 0 0-2.8 0Z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  download: "M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  monitor: "M4 5.5h16v10.5H4zM9 20h6M12 16v4",
  key: "M15 9a4.5 4.5 0 1 0-3.6 4.4L13 15h2v2h2v2h3.5v-3.2l-5.8-5.8c.2-.3.3-.6.3-1Z",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
