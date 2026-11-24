# The API service: Rust, with the game's simulation (src/*.js) baked into the binary for the
# leaderboard. Build context: the repository root (Railway: config file api/railway.json).
FROM rust:1-bookworm AS build
WORKDIR /app

# Dependencies first, so a code change doesn't rebuild them.
COPY api/Cargo.toml api/Cargo.lock api/
RUN mkdir -p api/src && echo 'fn main() {}' > api/src/main.rs \
    && cd api && cargo build --release --locked \
    && rm -rf src target/release/deps/selene_api* target/release/selene-api*

COPY src/grid.js src/config.js src/campaign.js src/benchmark.js src/
COPY api/ api/
RUN cd api && cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 selene
COPY --from=build /app/api/target/release/selene-api /usr/local/bin/selene-api
USER selene
# Listen on IPv6 and IPv4: Railway's private network reaches services over IPv6.
ENV HOST=:: PORT=8080
EXPOSE 8080
CMD ["selene-api"]
