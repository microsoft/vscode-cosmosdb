export function requireOptionValue(argv, index) {
    const value = argv[index + 1];
    if (value === undefined || value.trim().length === 0 || value.startsWith('--') || /^-[a-z]/iu.test(value)) {
        throw new Error(`${argv[index]} requires a value. Run with --help for usage.`);
    }
    return value;
}
