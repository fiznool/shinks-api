# Steps to set up

- Create postgres db
- Connect to pg instance
- Add `urls` table:

```
create table urls (id serial primary key, hash text not null, url text not null, created_at timestamp not null default now());
create unique index urls_hash_uniq on urls(hash);
```

- Lock down postgres db for public access, put in correct vpc
- Deploy with claudia
- Add lambda IAM role: AWSVPCLambdaExecute
- Edit lambda role to include correct VPC for postgres
