import { createContext, useContext, type ReactNode } from 'react';

const PreviewKeypadContext = createContext<readonly string[] | undefined>(undefined);

export function PreviewKeypadProvider({ keys, children }: { keys?: readonly string[]; children: ReactNode }) {
  return <PreviewKeypadContext.Provider value={keys}>{children}</PreviewKeypadContext.Provider>;
}

export function usePreviewKeypadKeys(): readonly string[] | undefined {
  return useContext(PreviewKeypadContext);
}
