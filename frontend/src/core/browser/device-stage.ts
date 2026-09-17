/* Implementation note. */
export const DEVICE_STAGE = {
  desktop: {
    width: 0,
    height: 0,
    label: "Desktop",
    description: "Fluid viewport",
  },
  tablet: {
    width: 768,
    height: 1024,
    label: "iPad",
    description: "768 x 1024",
  },
  mobile: {
    width: 390,
    height: 844,
    label: "iPhone",
    description: "390 x 844",
  },
} as const;
