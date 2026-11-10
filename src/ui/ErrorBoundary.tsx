// 予期しないエラーの受け皿 (スタブ)。後続の担当が中身を置き換える
import type { ReactNode } from 'react';

export function ErrorBoundary({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
