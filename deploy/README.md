# FinMate production deployment

FinMate deploys as two stateless containers to the existing `finmate` K3s namespace.
The existing `finmate` Service and Ingress keep their names, so the domain and TLS setup do
not need to change.

## One-time server preparation

Create the application secret without committing it:

```bash
sudo k3s kubectl create secret generic finmate-secrets \
  --namespace finmate \
  --from-literal=OPENROUTER_API_KEY='replace-me' \
  --dry-run=client -o yaml | sudo k3s kubectl apply -f -
```

The repository and its linked GHCR images are public, so K3s pulls the images anonymously.
If the repository becomes private later, add an `imagePullSecret` backed by a token with
`read:packages` instead of embedding registry credentials in this manifest.

The SSH user used by GitHub Actions must be allowed to run `sudo -n k3s kubectl ...`.
Use a dedicated deploy key and a narrowly scoped sudoers rule rather than a login password.

## GitHub production environment

Create a GitHub environment named `production` with these secrets:

- `SSH_HOST`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`

Do not put `OPENROUTER_API_KEY` in GitHub. It stays in the Kubernetes Secret on the server.

Run the `Deploy production` workflow manually for the first release. It builds immutable
SHA-tagged images, pushes them to GHCR, applies the rendered manifest, waits for both
rollouts, and calls the public readiness endpoint.

## Rollback

```bash
sudo k3s kubectl rollout undo deployment/finmate-backend -n finmate
sudo k3s kubectl rollout undo deployment/finmate -n finmate
sudo k3s kubectl rollout status deployment/finmate-backend -n finmate
sudo k3s kubectl rollout status deployment/finmate -n finmate
```
