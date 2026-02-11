import React from "react";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export const FormField: React.FC<Props> = ({ label, id, ...rest }) => {
  const inputId = id ?? rest.name;
  return (
    <div className="form-field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} {...rest} />
    </div>
  );
};

