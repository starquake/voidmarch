FROM golang:1.27.1 AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
# .git is not in the build context, so the commit and date arrive as build
# args; the version comes from the committed VERSION file.
ARG COMMIT=""
ARG DATE=""
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags="-s -w \
      -X github.com/starquake/voidmarch/internal/version.Version=$(cat VERSION) \
      -X github.com/starquake/voidmarch/internal/version.Commit=${COMMIT} \
      -X github.com/starquake/voidmarch/internal/version.Date=${DATE}" \
    -o /voidmarch ./cmd/voidmarch
# distroless has no shell to make the database directory, so it's made here.
RUN mkdir /data

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /voidmarch /voidmarch
# The licences of what the binary is built from (#196).
COPY THIRD-PARTY.md /THIRD-PARTY.md
COPY --from=build --chown=nonroot:nonroot /data /data
EXPOSE 8080
USER nonroot
ENV APP_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/voidmarch.db
VOLUME /data
# distroless has no shell or curl, so the binary checks its own health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/voidmarch", "-healthcheck"]
ENTRYPOINT ["/voidmarch"]
