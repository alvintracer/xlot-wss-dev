export function BusyButtonLabel({ children }: { children: string }) {
  return <span className="kw-button-busy"><span className="kw-button-spinner" aria-hidden="true" />{children}</span>;
}
