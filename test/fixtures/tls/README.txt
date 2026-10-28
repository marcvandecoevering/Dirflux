This self-signed certificate and private key are PUBLIC TEST FIXTURES.
secondary-cert.pem is a distinct certificate using key.pem, for per-listener
certificate selection and health-check pinning tests.
They only identify localhost/127.0.0.1 in automated loopback tests.
Never use these files for a deployed server or add them to a system trust store.
They are excluded from release archives by the package allowlist.
