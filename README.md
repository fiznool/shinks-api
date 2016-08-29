# Steps to set up

- Create postgres db
- Add `urls` table:

```
CREATE TABLE urls //etc.
```

- Deploy with claudia
- Add lambda IAM role: AWSVPCLambdaExecute
- Edit lambda role to include correct VPC for postgres
