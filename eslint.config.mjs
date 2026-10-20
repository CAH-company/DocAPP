import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "node_modules/**", "src/db/migrations/**"] }];
export default config;
