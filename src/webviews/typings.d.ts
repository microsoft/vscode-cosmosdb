declare global {
    declare module '*.ejs' {
        const template = <T>(data: T): string => '';
        export default template;
    }

    declare var __webpack_public_path__: string;
}
