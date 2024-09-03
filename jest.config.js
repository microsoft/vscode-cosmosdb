/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.jesttest.ts"],
  transform: {
    "^.+.tsx?$": ["ts-jest",{}],
  },
};
