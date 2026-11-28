export function showHelp(argv, usage) {
    if (!argv.includes('--help') && !argv.includes('-h')) return false;
    process.stdout.write(`${usage.trim()}\n\n  -h, --help  Show help without reading inputs or performing work.\n`);
    return true;
}
