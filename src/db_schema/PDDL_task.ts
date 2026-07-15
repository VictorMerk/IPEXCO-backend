
export interface PDDLType {
    name: string;
    parent: string;
  }
  
export interface PDDLObject {
    name: string;
    type: string;
}
  
export interface PDDLPredicate {
    name: string;
    negated: boolean;
    parameters: PDDLObject[];
}

export interface PDDLFact {
    name: string;
    arguments: string[]; 
    negated: boolean;
}

export interface PDDLFunctionAssignment {
    name: string;
    arguments: string[]; 
    value: number;
}

export interface PDDLAction {
    name: string; 
    parameters:  PDDLObject[];
    precondition: PDDLFact[];
    effect: PDDLFact[];
}

export interface PDDLPlanningDomain {
    constants: {
        name: string; 
        type: string | undefined;
    }[];
    types: PDDLType[];
    predicates: PDDLPredicate[];
    actions: PDDLAction[];
}

export interface PDDLPlanningProblem {
    objects: {
        name: string; 
        type: string | undefined;
    }[];
    initial: (PDDLFact | PDDLFunctionAssignment)[];
    goal: PDDLFact[];
}

export interface PDDLPlanningModel extends PDDLPlanningDomain, PDDLPlanningProblem {}


export function toPDDL(model: PDDLPlanningModel, with_goals=true): string[] {

    // domain
    let d = "(define (domain domainname)\n";
    d += "(:requirements :typing :action-costs)\n";

    d += "(:types\n" + 
        model.types
            .filter(t => t.name != 'object')
            .map(t => "\t\t" + t.name + " - " + (t.parent && t.parent != 'TODO' ? t.parent : 'object'))
            .join("\n") 
        + "\n)\n";

    if(!!model.constants && model.constants.length > 0){
        d += "(:constants \n" + model.constants.map(o => '\t' + o.name + " - " + o.type).join("\n") + "\n)\n";
    }

    d += "(:predicates \n" + model.predicates.map(
            pred => "\t(" + pred.name + ' ' + 
            pred.parameters.map(param => param.name + ' - ' + param.type).join(" ") + ")"
        ).join("\n") 
        + "\n)\n";

    d += model.actions
        .map(
            a => "(:action " + a.name + "\n\t:parameters (" + 
                a.parameters.map(p => p.name + ' - ' + p.type).join(" ") + ")\n" +
                "\t:precondition (and \n" +
                    a.precondition.map(p => 
                        p.negated ? 
                        "\t\t" + "(not (" + p.name + ' ' + p.arguments.join(" ") + "))" :
                        "\t\t" + "(" + p.name + ' ' + p.arguments.join(" ") + ")"
                    ).join('\n') +
                "\t)\n" +
                "\t:effect (and \n" +
                    a.effect.map(p => 
                        p.negated ? "\t\t" + "(not (" + p.name + ' ' + p.arguments.join(" ") + "))" :
                        "\t\t" + "(" + p.name + ' ' + p.arguments.join(" ") + ")"
                    ).join('\n') +
                "\t)\n)")
        .join("\n");

    d += "\n)";



    // problem
    let p = "(define (problem problemname)\n";
    p += "(:domain domainname)\n";

    p += "(:objects \n" + model.objects.map(o => '\t' + o.name + " - " + o.type).join("\n") + "\n)\n";

    p += "(:init\n " + model.initial.map(
        f => "value" in f
            ? `\t(= (${f.name} ${f.arguments.join(" ")}) ${f.value})`
            : f.negated
                ? `\t(not (${f.name} ${f.arguments.join(" ")}))`
                : `\t(${f.name} ${f.arguments.join(" ")})`).join("\n")
        + "\n)\n";

    if(with_goals){
        p += "(:goal (and \n" + 
            model.goal.map(f => f.negated
                ? `\t(not (${f.name} ${f.arguments.join(" ")}))`
                : `\t(${f.name} ${f.arguments.join(" ")})`).join("\n")
            + "))\n";
    }
    else {
        p += "(:goal (and ))\n";
    }
    p += ")";

        return [d,p];
}   


