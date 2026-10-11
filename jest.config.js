module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  moduleNameMapper: {
    "\\.sql$": "<rootDir>/tests/helpers/sqlTextStub"
  },
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\.ts$": "ts-jest",
    "^.+\.js$": "ts-jest"
  },


  transformIgnorePatterns: ["/node_modules/(?!@noble/)"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/types/**/*.ts",
    "!src/index.ts"
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};
