import { mock } from 'node:test';

export function mockDefaultStringCollation(locale) {
    const localeCompare = String.prototype.localeCompare;
    // Windows does not select Node's default locale from LANG/LC_ALL. Isolate this mock in the child process.
    mock.method(String.prototype, 'localeCompare', function (other, locales = locale, options) {
        return localeCompare.call(this, other, locales, options);
    });
}
