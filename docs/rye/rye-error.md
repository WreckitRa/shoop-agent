Guides
Handling API Errors
HTTP status codes, error messages, and resolution steps for common Rye API errors.

Our API uses standard HTTP status codes to indicate the success or failure of a request. When an error occurs, the response will include an error code and message. Your integration should handle these gracefully, with retry logic where appropriate, and surface clear messages to users when action is required.
Status Code Message How to Resolve
400 Bad Request Check your request payload and parameters for missing or invalid fields.
401 Unauthorized Ensure you are using the correct API key.
403 Forbidden Your API key does not have permission. Confirm access rights or contact support.
404 Not Found Verify the endpoint URL and resource ID.
409 Conflict The resource is in an invalid state (e.g., duplicate request). Retry if safe.
422 Unprocessable Entity Input validation failed. Check field formats and required attributes.
429 Too Many Requests You have exceeded the rate limit. See Rate Limits for limits, headers, and retry guidance.
500 Internal Server Error Temporary server issue. Retry the request or contact support if persistent.
503 Service Unavailable API is temporarily unavailable. Retry with backoff.
Specific Error Cases
A 404 error can occur if an order confirmation request is submitted before the order reaches awaiting_confirmation. Adding a short delay or polling until the order is ready will help prevent this error.
When creating a checkout intent, the buyer.country field is case sensitive. The expected input is uppercase.
If you get an Order Failed: No such token error, confirm that you are generating the card token with the Rye publishable key, rather than your own Stripe key.
constraint_total_price_exceeded and constraint_shipping_cost_exceeded are returned when the order total or shipping cost exceeds the value specified in the checkout request.
If you get the error The specified phone number does not match the expected pattern, please update the phone number in your request to use the format 010-010-0101.
