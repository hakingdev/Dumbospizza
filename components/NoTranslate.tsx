import type { HTMLAttributes, ReactNode } from 'react';

type NoTranslateProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
};

export function NoTranslate({ children, className = '', ...props }: NoTranslateProps) {
  const classes = ['notranslate', className].filter(Boolean).join(' ');

  return (
    <span translate="no" className={classes} {...props}>
      {children}
    </span>
  );
}
