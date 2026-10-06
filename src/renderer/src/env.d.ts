declare module '*.css'
declare module '*?raw' {
  const text: string
  export default text
}
declare module '*?inline' {
  const dataUrl: string
  export default dataUrl
}
