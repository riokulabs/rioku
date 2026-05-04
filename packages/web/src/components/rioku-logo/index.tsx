import { Box, type BoxProps } from '@mantine/core';

interface RiokuLogoProps extends Omit<BoxProps, 'children'> {
  size?: number;
}

/**
 * <RiokuLogo> — inline SVG kanji-R logo mark.
 *
 * Uses `fill="currentColor"` so it inherits Mantine's `c` prop for theming.
 * Defaults to `c="green"` (Mantine primary shade) which resolves correctly in
 * both light and dark mode via Mantine's color resolution.
 *
 * Pass `c="white"` for use on coloured backgrounds (e.g. splash screens).
 */
export function RiokuLogo({ size = 24, c = 'green', ...rest }: RiokuLogoProps) {
  return (
    <Box
      component="span"
      c={c}
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      {...rest}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="50 26 161 151"
        fill="currentColor"
        width={size}
        height={size}
        aria-label="Rioku"
        role="img"
      >
        <path d="M 56.22 171.50 Q 57.67 168.36 66.62 150.91 Q 79.92 124.97 90.99 98.28 Q 96.43 85.17 99.39 71.76 A 0.47 0.47 0.0 0 0 98.93 71.19 L 68.63 71.19 A 2.22 2.22 0.0 0 1 66.79 70.21 L 55.12 52.81 A 0.52 0.52 0.0 0 1 55.55 52.00 L 101.33 52.00 A 0.76 0.75 0.0 0 0 102.09 51.25 L 102.09 31.36 A 0.56 0.56 0.0 0 1 102.65 30.80 L 124.65 30.80 A 0.58 0.58 0.0 0 1 125.23 31.38 L 125.23 51.53 A 0.48 0.48 0.0 0 0 125.71 52.01 L 175.99 52.01 A 0.78 0.78 0.0 0 1 176.77 52.79 L 176.77 96.84 A 0.56 0.55 -15.0 0 1 176.49 97.32 L 146.61 114.58 A 0.29 0.28 -37.9 0 0 146.55 115.03 L 206.13 171.29 A 0.26 0.25 -23.2 0 1 205.95 171.73 L 167.23 171.73 A 1.24 1.21 -20.9 0 1 166.33 171.34 L 111.59 112.11 A 1.14 1.14 0.0 0 1 111.86 110.36 L 153.66 86.23 A 1.42 1.39 -15.4 0 0 154.36 85.02 L 154.36 71.53 A 0.37 0.37 0.0 0 0 153.99 71.16 L 123.27 71.16 A 0.45 0.45 0.0 0 0 122.83 71.51 Q 120.14 83.80 114.62 99.14 Q 113.02 103.58 112.16 105.30 C 110.76 108.12 110.29 110.23 108.85 113.48 Q 101.02 131.16 91.22 150.34 A 2.85 2.78 -2.9 0 1 90.17 151.47 L 56.71 171.93 A 0.34 0.34 0.0 0 1 56.22 171.50 Z" />
      </svg>
    </Box>
  );
}
