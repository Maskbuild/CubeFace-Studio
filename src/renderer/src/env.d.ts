declare module '*.css'
declare module '*?raw' {
  const text: string
  export default text
}
declare module '*?inline' {
  const dataUrl: string
  export default dataUrl
}
declare module '*.png' {
  const url: string
  export default url
}
/** App version from package.json (set by the build). */
declare const __APP_VERSION__: string
