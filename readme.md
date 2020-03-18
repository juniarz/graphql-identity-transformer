# graphql-objectmeta-transformer

This is a graphql transformer package to be used with the [AWS Amplify](https://github.com/aws-amplify/amplify-cli) toolchain.

## Install the transformer

- Requires Node.js® version 10 or later

```bash
$ npm install -g graphql-objectmeta-transformer
```

## Enable the transformer

\<project folder\>/amplify/backend/api/\<api name\>/transform.conf.json, add:

```json
{
  ...
  "transformers": [
    "@juniarz/graphql-objectmeta-transformerr"
  ]
}
```

## Usage

```graphql
directive @objectmeta(
  createdAtField: String = "createdAt"
  createdByField: String = "createdBy"
  updatedAtField: String = "updatedAt"
  updatedByField: String = "updatedBy"
  deletedField: String = "deleted"
  deletedAtField: String = "deletedAt"
  deletedByField: String = "deletedBy"
  softDelete: Boolean = true
  identityRequired: Boolean = false
) on OBJECT
```

```graphql
type Post @auth @model @objectmeta {
  id: ID
  author: String
  createdAt: Float
  createdBy: ID
  updatedAt: Float
  updatedBy: ID
  deleted: Boolean!
  deletedAt: Float
  deletedBy: ID
}
```

mutation createPost

```graphql
mutation {
    ...
    createPost(input: CreatePostInput!)
    ...
    updatePost(inpute: UpdatePostInput!)
    ...
}
...
input CreatePostInput {
    id: ID
    author: String
}
...
input UpdatePostInput {
    id: ID
    author: String
}
...
```

## Author

- [JuniarZ](https://github.com/juniarz)
