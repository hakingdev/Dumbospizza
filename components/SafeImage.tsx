/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from 'react';

type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
};

export function SafeImage({ alt, loading = 'lazy', decoding = 'async', ...props }: SafeImageProps) {
  return <img alt={alt} loading={loading} decoding={decoding} {...props} />;
}
