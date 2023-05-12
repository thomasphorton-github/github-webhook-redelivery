zip -r ./build/function.zip *
aws lambda update-function-code --function-name thomasphorton-get-webhook-deliveries --zip-file fileb://build/function.zip
aws lambda invoke --function-name thomasphorton-get-webhook-deliveries --payload '{}' ../response.json
cat ../response.json