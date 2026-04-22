# The Sus Rooms

## Dev guide

How to deploy with app-cdi project.

`./scripts/deploy.sh --key susrooms --repo mhgump/thesusroom --min 1 --max 1 --machine-type e2-standard-2 --github-token $(cat ~/tokens/thesusrooms-deploy) --dockerfile docker/prod/Dockerfile`
