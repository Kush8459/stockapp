# syntax=docker/dockerfile:1.7
# ---- Build stage ---------------------------------------------------------
# Keep in sync with the `go` directive in go.mod — the toolchain refuses to
# build when the image Go is older than go.mod's declared version.
FROM golang:1.25-alpine AS builder

WORKDIR /src

# Cache modules in a separate layer so rebuilds after source-only changes
# are instant.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

ARG TARGET=server
ARG VERSION=dev

# Static, stripped, versioned binary.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
        -trimpath \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o /out/app \
        ./cmd/${TARGET}

# ---- Runtime stage -------------------------------------------------------
# distroless/static gives us a minimal, non-root, CA-bundled image. No shell,
# no package manager — just the binary and TLS roots.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=builder /out/app /app

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
