export {}

declare global {
  interface Window {
    /** Set by the page of each language before the bundle loads. */
    __LANGUAGE__?: string
    MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker }
  }
}
