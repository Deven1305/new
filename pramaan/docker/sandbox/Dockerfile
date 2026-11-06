# Pramaan analysis sandbox: everything that touches untrusted repository code runs in here, as uid 1000,
# with `docker run --network none --read-only --cap-drop ALL --security-opt no-new-privileges` (see packages/engine).
# Build:  pnpm pramaan sandbox build      (context = repository root)
FROM python:3.12-slim-bookworm

ARG FOUNDRY_VERSION=v1.8.7
ARG ADERYN_VERSION=aderyn-v0.6.8
ARG SLITHER_VERSION=0.11.6
ARG SOLC_VERSIONS="0.8.20 0.8.24 0.8.26 0.8.28 0.8.30 0.8.33 0.8.35 0.8.38"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Foundry (checksum-verified release tarball)
RUN set -eux; \
    base="https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}"; \
    curl -fsSL -o /tmp/foundry.tgz "${base}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz"; \
    curl -fsSL -o /tmp/foundry.sha256 "${base}/foundry_${FOUNDRY_VERSION}_linux_amd64.sha256"; \
    echo "$(cut -d' ' -f1 /tmp/foundry.sha256)  /tmp/foundry.tgz" | sha256sum -c -; \
    tar -xzf /tmp/foundry.tgz -C /usr/local/bin forge cast anvil; \
    rm /tmp/foundry.*; forge --version

# Aderyn (Linux only; checksum-verified)
RUN set -eux; \
    base="https://github.com/Cyfrin/aderyn/releases/download/${ADERYN_VERSION}"; \
    curl -fsSL -o /tmp/aderyn.tar.xz "${base}/aderyn-x86_64-unknown-linux-gnu.tar.xz"; \
    curl -fsSL -o /tmp/aderyn.sha256 "${base}/aderyn-x86_64-unknown-linux-gnu.tar.xz.sha256"; \
    echo "$(cut -d' ' -f1 /tmp/aderyn.sha256)  /tmp/aderyn.tar.xz" | sha256sum -c -; \
    mkdir -p /tmp/aderyn && tar -xJf /tmp/aderyn.tar.xz -C /tmp/aderyn; \
    find /tmp/aderyn -type f -name aderyn -exec install -m 0755 {} /usr/local/bin/aderyn \; ; \
    rm -rf /tmp/aderyn /tmp/aderyn.*; aderyn --version

# Slither + Pramaan's detectors
COPY tools/slither-plugin /opt/pramaan/slither-plugin
RUN pip install --no-cache-dir "slither-analyzer==${SLITHER_VERSION}" /opt/pramaan/slither-plugin && slither --version

# Pinned solc builds in the svm layout forge expects (~/.svm/<v>/solc-<v>), sha256-checked against soliditylang's list
COPY docker/sandbox/install_solc.py /opt/pramaan/install_solc.py
RUN python /opt/pramaan/install_solc.py /opt/svm ${SOLC_VERSIONS}

# forge-std copy for generated exploit tests (imported as lib/pramaan-forge-std/src/Test.sol)
COPY contracts/lib/forge-std /opt/pramaan/forge-std
COPY docker/sandbox/runner.py /opt/pramaan/runner.py

RUN useradd --uid 1000 --create-home --home-dir /home/pramaan pramaan
USER 1000:1000
ENV HOME=/work/home \
    FOUNDRY_FFI=false \
    FOUNDRY_OFFLINE=true \
    FOUNDRY_DISABLE_NIGHTLY_WARNING=1 \
    NO_COLOR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /work
ENTRYPOINT ["python3", "-I", "/opt/pramaan/runner.py"]
