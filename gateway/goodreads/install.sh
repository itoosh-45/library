#!/usr/bin/env bash
set -euo pipefail
# This installer is intentionally single-purpose and does not touch existing containers.
install_root=/opt/library-goodreads
source_root=/home/ubuntu/library-goodreads-upload
proxy_custom=/home/ubuntu/docker/npm/data/nginx/custom
test "$(id -u)" = 0
test -f "$source_root/goodreads/run.mjs"
test ! -e "$install_root"
test ! -e "$proxy_custom/server_proxy.conf"
test "$(df --output=avail -k / | tail -1)" -gt 2097152
test "$(awk '/MemAvailable/ {print $2}' /proc/meminfo)" -gt 1048576
test "$(docker ps --filter name=^/library-goodreads$ --format '{{.Names}}')" = ''
install -d -m 0755 "$install_root/app/goodreads"
install -d -m 0700 -o 1000 -g 1000 "$install_root/data" "$install_root/secrets"
install -m 0644 "$source_root/quota.ts" "$install_root/app/quota.ts"
for file in model.mjs danibooks.mjs service.mjs run.mjs Dockerfile nginx.conf; do install -m 0644 "$source_root/goodreads/$file" "$install_root/app/goodreads/$file"; done
openssl rand -hex 32 > "$install_root/secrets/library-token"
chown 1000:1000 "$install_root/secrets/library-token"
chmod 0400 "$install_root/secrets/library-token"
docker pull node:24-alpine
node_image=$(docker image inspect node:24-alpine --format '{{index .RepoDigests 0}}')
printf '%s\n' "$node_image" > "$install_root/node-image.txt"
docker build --build-arg "NODE_IMAGE=$node_image" -t library-goodreads:1 -f "$install_root/app/goodreads/Dockerfile" "$install_root/app"
docker run -d --name library-goodreads --network proxy-net \
  --cpus=0.25 --memory=192m --memory-swap=192m --pids-limit=64 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --restart=unless-stopped --log-driver=local --log-opt max-size=5m --log-opt max-file=2 \
  --mount "type=bind,src=$install_root/data,dst=/data" \
  --mount "type=bind,src=$install_root/secrets/library-token,dst=/run/secrets/library-token,readonly" \
  -p 127.0.0.1:4336:4333 \
  --health-cmd='node -e "fetch(\"http://127.0.0.1:4333/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"' \
  --health-interval=60s --health-timeout=5s --health-start-period=10s --health-retries=3 \
  library-goodreads:1
for attempt in 1 2 3 4 5; do if curl -fsS --max-time 3 http://127.0.0.1:4336/health; then break; fi; sleep 2; done
curl -fsS --max-time 3 http://127.0.0.1:4336/health >/dev/null
install -d -m 0755 "$proxy_custom"
install -m 0644 "$install_root/app/goodreads/nginx.conf" "$proxy_custom/server_proxy.conf"
if ! docker exec npm nginx -t; then
  # Remove only the file this installer just created; do not change other proxy routes.
  rm -- "$proxy_custom/server_proxy.conf"
  docker stop library-goodreads
  exit 1
fi
docker exec npm nginx -s reload
printf '\nInstalled isolated Goodreads service. Existing containers were not restarted.\n'
