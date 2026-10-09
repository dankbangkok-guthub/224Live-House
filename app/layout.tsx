import type { ReactNode } from 'react';
import './style.css';
export const metadata={title:'224 Live House — Private Space',description:'Plan your private event at 224 Live House.'};
export default function Layout({children}:{children:ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
