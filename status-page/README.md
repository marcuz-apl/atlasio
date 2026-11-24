# Atlasio development status page

This standalone container serves the static development status page on port 80. It does not depend on the Atlasio application or its database.

Build it from the repository root:

```sh
docker build -t atlasio-status-page:latest ./status-page
```

Run it locally on port 8080:

```sh
docker run --rm -p 8080:80 atlasio-status-page:latest
```

The container listens on port 80. Your reverse proxy can route the public hostname to that port; tag and publish the image to your chosen registry when ready.
