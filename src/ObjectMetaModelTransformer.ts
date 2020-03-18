import { AppSync, Fn } from "cloudform-types";
import {
  Transformer,
  TransformerContext,
  InvalidDirectiveError,
  gql,
  TransformerContractError
} from "graphql-transformer-core";
import {
  valueFromASTUntyped,
  ArgumentNode,
  ObjectTypeDefinitionNode,
  DirectiveNode,
  Kind
} from "graphql";
import {
  printBlock,
  compoundExpression,
  set,
  ref,
  qref,
  raw,
  iff,
  Expression,
  equals,
  bool
} from "graphql-mapping-template";
import {
  ResolverResourceIDs,
  ModelResourceIDs,
  getBaseType,
  makeNonNullType,
  makeField,
  makeNamedType,
  makeInputObjectDefinition,
  makeInputValueDefinition,
  ResourceConstants
} from "graphql-transformer-common";

export default class ObjectMetaModelTransformer extends Transformer {
  private createdAtField = "createdAt";
  private createdByField = "createdBy";
  private updatedAtField = "updatedAt";
  private updatedByField = "updatedBy";
  private deletedField = "deleted";
  private deletedAtField = "deletedAt";
  private deletedByField = "deletedBy";
  private softDelete = true;
  private identityRequired = false;
  private typeName = "";

  constructor() {
    super(
      "ObjectMetaModelTransformer",
      gql`
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
      `
    );
  }

  public object = (
    def: ObjectTypeDefinitionNode,
    directive: DirectiveNode,
    ctx: TransformerContext
  ): void => {
    const modelDirective = def.directives
      ? def.directives.find(dir => dir.name.value === "model")
      : undefined;
    if (!modelDirective) {
      throw new InvalidDirectiveError(
        "Types annotated with @objectmeta must also be annotated with @model."
      );
    }

    const authDirective = def.directives
      ? def.directives.find(dir => dir.name.value === "auth")
      : undefined;
    if (!authDirective) {
      throw new InvalidDirectiveError(
        "Types annotated with @objectmeta must also be annotated with @auth."
      );
    }

    const isArg = (s: string) => (arg: ArgumentNode) => arg.name.value === s;
    const getArg = (arg: string, dflt?: any) => {
      const argument = directive.arguments
        ? directive.arguments.find(isArg(arg))
        : undefined;
      return argument ? valueFromASTUntyped(argument.value) : dflt;
    };

    this.createdAtField = getArg("createdAtField", "createdAt");
    this.createdByField = getArg("createdByField", "createdBy");
    this.updatedAtField = getArg("updatedAtField", "updatedAt");
    this.updatedByField = getArg("updatedByField", "updatedBy");
    this.deletedField = getArg("deletedField", "deleted");
    this.deletedAtField = getArg("deletedAtField", "deletedAt");
    this.deletedByField = getArg("deletedByField", "deletedBy");
    this.softDelete = getArg("softDelete", true);
    this.identityRequired = getArg("identityRequired", false);
    this.typeName = def.name.value;

    this.augmentCreateMutation(ctx);
    this.augmentUpdateMutation(ctx);
    if (this.softDelete) {
      this.addSoftDeleteMutation(def, ctx);
    }
    this.stripCreateInputField(ctx);
    this.stripUpdateInputFields(ctx);
    this.enforceFieldsOnType(ctx);
  };

  private getCreateExpressions = () => {
    const expressions: Expression[] = [
      set(
        ref("identityValue"),
        raw(
          `$util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("cognito:username"), ${
            this.identityRequired ? null : "-NO-IDENTITY-"
          }))`
        )
      )
    ];

    if (this.identityRequired) {
      expressions.push(
        iff(
          raw("$util.isNullOrEmpty($identityValue)"),
          raw('$util.error("Invalid identity.")')
        )
      );
    }

    expressions.push(
      qref(
        `$ctx.args.input.put("${this.createdAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.createdByField}", $identityValue)`)
    );
    expressions.push(
      qref(
        `$ctx.args.input.put("${this.updatedAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.updatedByField}", $identityValue)`)
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.deletedField}", false)`)
    );

    return expressions;
  };

  private augmentCreateMutation(ctx: TransformerContext) {
    const snippet = printBlock(`ObjectMeta Fields`)(
      compoundExpression(this.getCreateExpressions())
    );
    const mutationResolverLogicalId = ResolverResourceIDs.DynamoDBCreateResolverResourceID(
      this.typeName
    );
    const resolver = ctx.getResource(mutationResolverLogicalId);
    if (resolver && resolver.Properties) {
      resolver.Properties.RequestMappingTemplate =
        snippet + "\n\n" + resolver.Properties.RequestMappingTemplate;
      ctx.setResource(mutationResolverLogicalId, resolver);
    }
  }

  private getUpdateExpressions = () => {
    const expressions: Expression[] = [
      set(
        ref("$identityValue"),
        raw(
          `$util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("cognito:username"), ${
            this.identityRequired ? null : "-NO-IDENTITY-"
          }))`
        )
      )
    ];

    if (this.identityRequired) {
      expressions.push(
        iff(
          raw("$util.isNullOrEmpty($identityValue)"),
          raw('$util.error("Invalid identity.")')
        )
      );
    }

    expressions.push(
      qref(
        `$ctx.args.input.put("${this.createdAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.createdByField}", $identityValue)`)
    );
    expressions.push(
      qref(
        `$ctx.args.input.put("${this.updatedAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.updatedByField}", $identityValue)`)
    );

    expressions.push(
      iff(
        equals(raw(`$ctx.args.input.${this.deletedField}`), bool(true)),
        compoundExpression([
          qref(`$ctx.args.input.put("${this.deletedField}", false)`),
          qref(
            `$ctx.args.input.put("${this.deletedAtField}", $util.time.nowEpochMilliSeconds())`
          ),
          qref(`$ctx.args.input.put("${this.deletedByField}", $identityValue)`)
        ])
      )
    );

    return expressions;
  };

  private augmentUpdateMutation(ctx: TransformerContext) {
    const mutationResolverLogicalId = ResolverResourceIDs.DynamoDBUpdateResolverResourceID(
      this.typeName
    );
    const snippet = printBlock(`ObjectMeta Fields`)(
      compoundExpression(this.getUpdateExpressions())
    );
    const resolver = ctx.getResource(mutationResolverLogicalId);
    if (resolver) {
      if (!resolver.Properties) {
        resolver.Properties = {};
      }
      resolver.Properties.RequestMappingTemplate =
        snippet + "\n\n" + resolver.Properties.RequestMappingTemplate;
      ctx.setResource(mutationResolverLogicalId, resolver);
    }
  }

  // TODO
  private getSoftDeleteExpressions = () => {
    const expressions: Expression[] = [
      set(
        ref("$identityValue"),
        raw(
          `$util.defaultIfNull($ctx.identity.claims.get("username"), $util.defaultIfNull($ctx.identity.claims.get("cognito:username"), ${
            this.identityRequired ? null : "-NO-IDENTITY-"
          }))`
        )
      )
    ];

    if (this.identityRequired) {
      expressions.push(
        iff(
          raw("$util.isNullOrEmpty($identityValue)"),
          raw('$util.error("Invalid identity.")')
        )
      );
    }
    expressions.push(
      qref(
        `$ctx.args.input.put("${this.createdAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.createdByField}", $identityValue)`)
    );
    expressions.push(
      qref(
        `$ctx.args.input.put("${this.updatedAtField}", $util.time.nowEpochMilliSeconds())`
      )
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.updatedByField}", $identityValue)`)
    );
    expressions.push(
      qref(`$ctx.args.input.put("${this.deletedField}", false)`)
    );

    return expressions;
  };

  // TODO
  private addSoftDeleteMutation = (
    def: ObjectTypeDefinitionNode,
    ctx: TransformerContext
  ) => {
    if (!this.softDelete) {
      return;
    }

    const mutationResolverLogicalId = ResolverResourceIDs.DynamoDBUpdateResolverResourceID(
      this.typeName
    );
    const softDeleteResourceID = "SoftDelete" + this.typeName + "Resolver";
    const softDeleteFieldName = "softDelete" + this.typeName;
    const softDeleteInputName = "SoftDelete" + this.typeName + "Input";

    const softDeleteInput = makeInputObjectDefinition(softDeleteInputName, [
      makeInputValueDefinition("id", makeNonNullType(makeNamedType("ID")))
    ]);

    if (!ctx.getType(softDeleteInput.name.value)) {
      ctx.addInput(softDeleteInput);
    }
    ctx.addMutationFields([
      makeField(
        softDeleteFieldName,
        [makeInputValueDefinition("id", makeNonNullType(makeNamedType("ID")))],
        makeNamedType(def.name.value)
      )
    ]);

    const updateResolver = ctx.getResource(mutationResolverLogicalId);

    const snippet = printBlock(`ObjectMeta Fields`)(
      compoundExpression(this.getSoftDeleteExpressions())
    );

    const softDeleterResolver = new AppSync.Resolver({
      ApiId: Fn.GetAtt(
        ResourceConstants.RESOURCES.GraphQLAPILogicalID,
        "ApiId"
      ),
      DataSourceName: Fn.GetAtt(
        ModelResourceIDs.ModelTableDataSourceID(def.name.value),
        "Name"
      ),
      FieldName: softDeleteFieldName,
      TypeName: "Mutation",
      RequestMappingTemplate:
        snippet + "\n" + updateResolver.Properties!.RequestMappingTemplate,
      ResponseMappingTemplate: updateResolver.Properties!
        .ResponseMappingTemplate
    });

    ctx.setResource(softDeleteResourceID, softDeleterResolver);
    ctx.mapResourceToStack(def.name.value, softDeleteResourceID);
  };

  private stripCreateInputField(ctx: TransformerContext) {
    const createInputName = ModelResourceIDs.ModelCreateInputObjectName(
      this.typeName
    );
    const input = ctx.getType(createInputName);
    if (
      input &&
      input.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
      input.fields
    ) {
      const updatedFields = input.fields.filter(
        f =>
          f.name.value !== this.createdAtField &&
          f.name.value !== this.createdByField &&
          f.name.value !== this.updatedAtField &&
          f.name.value !== this.updatedByField &&
          f.name.value !== this.deletedField &&
          f.name.value !== this.deletedAtField &&
          f.name.value !== this.deletedByField
      );
      if (updatedFields.length === 0) {
        throw new InvalidDirectiveError(
          `After stripping away object meta fields "${this.createdAtField}", "${this.createdByField}", "${this.updatedAtField}", "${this.updatedByField}", "${this.deletedField}", "${this.deletedAtField}", "${this.deletedByField}" \
                    the create input for type "${this.typeName}" cannot be created \
                    with 0 fields. Add another field to type "${this.typeName}" to continue.`
        );
      }
      const updatedInput = {
        ...input,
        fields: updatedFields
      };
      ctx.putType(updatedInput);
    }
  }

  private stripUpdateInputFields(ctx: TransformerContext) {
    const createInputName = ModelResourceIDs.ModelUpdateInputObjectName(
      this.typeName
    );
    const input = ctx.getType(createInputName);
    if (
      input &&
      input.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
      input.fields
    ) {
      const updatedFields = input.fields.filter(
        f =>
          f.name.value !== this.createdAtField &&
          f.name.value !== this.createdByField &&
          f.name.value !== this.updatedAtField &&
          f.name.value !== this.updatedByField &&
          f.name.value !== this.deletedField &&
          f.name.value !== this.deletedAtField &&
          f.name.value !== this.deletedByField
      );
      if (updatedFields.length === 0) {
        throw new InvalidDirectiveError(
          `After stripping away object meta fields "${this.createdAtField}", "${this.createdByField}", "${this.updatedAtField}", "${this.updatedByField}", "${this.deletedField}", "${this.deletedAtField}", "${this.deletedByField}" \
                    the update input for type "${this.typeName}" cannot be created \
                    with 0 fields. Add another field to type "${this.typeName}" to continue.`
        );
      }
      const updatedInput = {
        ...input,
        fields: updatedFields
      };
      ctx.putType(updatedInput);
    }
  }

  private enforceFieldsOnType(ctx: TransformerContext) {
    const type = ctx.getType(this.typeName);
    if (type && type.kind === Kind.OBJECT_TYPE_DEFINITION && type.fields) {
      let updatedFields = type.fields;

      const createdAtFieldImpl = type.fields.find(
        f => f.name.value === this.createdAtField
      );
      let createdAtField = createdAtFieldImpl;
      if (createdAtFieldImpl) {
        const baseType = getBaseType(createdAtFieldImpl.type);
        if (baseType !== "Float") {
          throw new TransformerContractError(
            `The createdAtField "${this.createdAtField}" is required to be of type "Float".`
          );
        }
      } else {
        createdAtField = makeField(
          this.createdAtField,
          [],
          makeNamedType("Float")
        );
        updatedFields = [...updatedFields, createdAtField];
      }

      const createdByFieldImpl = type.fields.find(
        f => f.name.value === this.createdByField
      );
      let createdByField = createdByFieldImpl;
      if (createdByFieldImpl) {
        const baseType = getBaseType(createdByFieldImpl.type);
        if (
          baseType !== "ID" ||
          (this.identityRequired &&
            createdByFieldImpl.type.kind !== Kind.NON_NULL_TYPE)
        ) {
          throw new TransformerContractError(
            `The createdByField "${
              this.createdByField
            }" is required to be of type "ID${
              this.identityRequired ? "!" : ""
            }".`
          );
        }
      } else {
        createdByField = makeField(
          this.createdByField,
          [],
          this.identityRequired
            ? makeNonNullType(makeNamedType("ID"))
            : makeNamedType("ID")
        );
        updatedFields = [...updatedFields, createdByField];
      }

      const updatedAtFieldImpl = type.fields.find(
        f => f.name.value === this.updatedAtField
      );
      let updatedAtField = updatedAtFieldImpl;
      if (updatedAtFieldImpl) {
        const baseType = getBaseType(updatedAtFieldImpl.type);
        if (baseType !== "Float") {
          throw new TransformerContractError(
            `The updatedAtField "${this.updatedAtField}" is required to be of type "Float".`
          );
        }
      } else {
        updatedAtField = makeField(
          this.updatedAtField,
          [],
          makeNamedType("Float")
        );
        updatedFields = [...updatedFields, updatedAtField];
      }

      const updatedByFieldImpl = type.fields.find(
        f => f.name.value === this.updatedByField
      );
      let updatedByField = updatedByFieldImpl;
      if (updatedByFieldImpl) {
        const baseType = getBaseType(updatedByFieldImpl.type);
        if (
          baseType !== "ID" ||
          (this.identityRequired &&
            updatedByFieldImpl.type.kind !== Kind.NON_NULL_TYPE)
        ) {
          throw new TransformerContractError(
            `The updatedByField "${
              this.updatedByField
            }" is required to be of type "ID${
              this.identityRequired ? "!" : ""
            }".`
          );
        }
      } else {
        updatedByField = makeField(
          this.updatedByField,
          [],
          this.identityRequired
            ? makeNonNullType(makeNamedType("ID"))
            : makeNamedType("ID")
        );
        updatedFields = [...updatedFields, updatedByField];
      }

      const deletedFieldImpl = type.fields.find(
        f => f.name.value === this.deletedField
      );
      if (deletedFieldImpl) {
        const baseType = getBaseType(deletedFieldImpl.type);
        if (
          baseType !== "Boolean" ||
          deletedFieldImpl.type.kind !== Kind.NON_NULL_TYPE
        ) {
          throw new TransformerContractError(
            `Type "${this.typeName}" requires deletedField "${this.deletedField}" is required to be of type "Boolean!".`
          );
        }
      } else {
        throw new TransformerContractError(
          `Type "${this.typeName}" requires deletedField "${this.deletedField}" is required to be of type "Boolean!".`
        );
      }

      const deletedAtFieldImpl = type.fields.find(
        f => f.name.value === this.deletedAtField
      );
      let deletedAtField = deletedAtFieldImpl;
      if (deletedAtFieldImpl) {
        const baseType = getBaseType(deletedAtFieldImpl.type);
        if (baseType !== "Float") {
          throw new TransformerContractError(
            `The deletedAtField "${this.deletedAtField}" is required to be of type "Float".`
          );
        }
      } else {
        deletedAtField = makeField(
          this.deletedAtField,
          [],
          makeNamedType("Float")
        );
        updatedFields = [...updatedFields, deletedAtField];
      }

      const deletedByFieldImpl = type.fields.find(
        f => f.name.value === this.deletedByField
      );
      let deletedByField = deletedByFieldImpl;
      if (deletedByFieldImpl) {
        const baseType = getBaseType(deletedByFieldImpl.type);
        if (
          baseType !== "ID" ||
          (this.identityRequired &&
            deletedByFieldImpl.type.kind !== Kind.NON_NULL_TYPE)
        ) {
          throw new TransformerContractError(
            `The deletedByField "${
              this.deletedByField
            }" is required to be of type "ID${
              this.identityRequired ? "!" : ""
            }".`
          );
        }
      } else {
        deletedByField = makeField(
          this.deletedByField,
          [],
          this.identityRequired
            ? makeNonNullType(makeNamedType("ID"))
            : makeNamedType("ID")
        );
        updatedFields = [...updatedFields, deletedByField];
      }

      const updatedType = {
        ...type,
        fields: updatedFields
      };

      ctx.putType(updatedType);
    }
  }
}
