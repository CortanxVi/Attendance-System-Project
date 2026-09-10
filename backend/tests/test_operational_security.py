import unittest

from core.operational import OperationalHeadersMiddleware


class OperationalHeadersTests(unittest.IsolatedAsyncioTestCase):
    async def test_untrusted_request_id_is_replaced_and_security_headers_are_added(self):
        sent: list[dict] = []

        async def inner(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        middleware = OperationalHeadersMiddleware(inner, production=True)
        await middleware(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/v1/example",
                "headers": [(b"x-request-id", b"bad id with spaces")],
            },
            receive,
            send,
        )
        headers = dict(sent[0]["headers"])
        self.assertRegex(headers[b"x-request-id"].decode("ascii"), r"^[a-f0-9]{32}$")
        self.assertEqual(headers[b"x-content-type-options"], b"nosniff")
        self.assertIn(b"frame-ancestors 'none'", headers[b"content-security-policy"])
        self.assertEqual(headers[b"cache-control"], b"no-store")

    async def test_valid_correlation_id_is_preserved(self):
        sent: list[dict] = []

        async def inner(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        middleware = OperationalHeadersMiddleware(inner)
        await middleware(
            {
                "type": "http",
                "method": "GET",
                "path": "/health/live",
                "headers": [(b"x-request-id", b"request-12345678")],
            },
            receive,
            send,
        )
        self.assertEqual(dict(sent[0]["headers"])[b"x-request-id"], b"request-12345678")


if __name__ == "__main__":
    unittest.main()
